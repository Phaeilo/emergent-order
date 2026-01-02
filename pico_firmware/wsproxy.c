// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

/**
 * WS2812 Proxy - UART to WS2812 LED Bridge
 *
 * Receives RGB pixel data via USB UART and forwards to 8 WS2812 channels
 * Supports up to 200 LEDs per channel @ 60Hz refresh rate
 *
 * Protocol Format:
 * 1. Update and auto-flush (immediate update):
 *    [0xFF][CHANNEL_ID][LED_COUNT_LOW][LED_COUNT_HIGH][R][G][B]...[R][G][B]
 *
 * 2. Update buffer only (no flush):
 *    [0xFE][CHANNEL_ID][LED_COUNT_LOW][LED_COUNT_HIGH][R][G][B]...[R][G][B]
 *
 * 3. Selective flush command:
 *    [0xFD][CHANNEL_MASK]
 *
 * 4. Reset Pico:
 *    [0xFC]
 *
 * 5. Start test pattern:
 *    [0xFB][PATTERN_ID]
 *
 * 6. Stop test pattern:
 *    [0xFA]
 *
 * 7. Clear all LEDs:
 *    [0xF9]
 *
 * Command bytes:
 * 0xFF - Update channel and immediately flush to LEDs
 * 0xFE - Update channel buffer only (no flush)
 * 0xFD - Flush command: next byte is channel mask (bit 0=ch0, bit 1=ch1, etc.)
 * 0xFC - Reset Pico
 * 0xFB - Start test pattern (next byte is pattern ID)
 * 0xFA - Stop test pattern
 * 0xF9 - Clear all LEDs (set all channels to black and flush immediately)
 *
 * CHANNEL_ID: 0-7 (which WS2812 channel)
 * LED_COUNT: 16-bit LED count (little-endian)
 * RGB data: 3 bytes per LED (R, G, B)
 * CHANNEL_MASK: 8-bit mask where each bit enables flush for that channel
 * PATTERN_ID: Test pattern number (0-255)
 *
 * Features:
 * - Gamma correction (adjustable)
 * - Current limiting per channel with automatic brightness scaling
 * - Test patterns (auto-activates after timeout)
 * - Periodic status reports (1 Hz)
 * - Temperature monitoring (2x NTC sensors)
 * - Current/voltage monitoring (INA226)
 * - Channel trip detection (8 voltage feedback channels)
 * - Status LEDs (activity and fault indicators)
 * - Button support (reset and pattern cycle)
 */

#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <math.h>
#include "pico/stdlib.h"
#include "hardware/pio.h"
#include "hardware/uart.h"
#include "hardware/adc.h"
#include "hardware/i2c.h"
#include "hardware/watchdog.h"
#include "hardware/dma.h"
#include "WS2812.pio.h"

// ============================================================================
// Configuration
// ============================================================================

// WS2812 Configuration
#define NUM_CHANNELS 8
#define MAX_LEDS_PER_CHANNEL 200
#define BYTES_PER_LED 3
#define WS2812_PIN_BASE 8  // GPIO 8-15

// Gamma Correction
#ifndef GAMMA_CORRECTION_ENABLE
#define GAMMA_CORRECTION_ENABLE 1
#endif

#ifndef GAMMA_VALUE
#define GAMMA_VALUE 2.8f
#endif

// Current Limiting Configuration
#define CURRENT_LIMIT_ENABLE 1
#define CURRENT_LIMIT_THRESHOLD 30000  // Brightness units (tunable)

// Test Pattern Configuration
#define TEST_PATTERN_TIMEOUT_MS 5000  // Auto-activate after 5s no data
#define TEST_PATTERN_DEFAULT_LEDS 200 // Default LEDs per channel for patterns
#define NUM_TEST_PATTERNS 6           // Total number of test patterns

// Test Pattern IDs
typedef enum {
    PATTERN_CHANNEL_ID = 0,         // Channel identification with minimal power (first/last N LEDs blink)
    PATTERN_RGB_CYCLE = 1,          // Cycle through Red, Green, Blue
    PATTERN_COLOR_CYCLE = 2,        // Cycle through R, G, B, C, M, Y, W, Black
    PATTERN_END_BLINK = 3,          // Alternating red blink on first and last LED
    PATTERN_TERNARY = 4,            // Ternary encoding for camera calibration
    PATTERN_COLORFUL_TWINKLE = 5    // Channel colors with full twinkling effect
} test_pattern_id_t;

// Update Rates
#define STATUS_REPORT_INTERVAL_MS 1000  // Log status once a second
#define SENSOR_UPDATE_RATE_HZ 20        // Sensor readings at 20 Hz
#define SENSOR_UPDATE_INTERVAL_US (1000000 / SENSOR_UPDATE_RATE_HZ)
#define PATTERN_UPDATE_RATE_HZ 30       // Test pattern animation at 30 Hz
#define PATTERN_UPDATE_INTERVAL_US (1000000 / PATTERN_UPDATE_RATE_HZ)

// Fault Detection Thresholds
#define FAULT_TEMP_THRESHOLD 60.0f      // °C - trigger fault above this temperature
#define FAULT_CURRENT_THRESHOLD 10.0f   // A - trigger fault above this current
#define FAULT_VOLTAGE_THRESHOLD 1.0f    // V - channel active above this voltage (trip below)
#define FAULT_DEBUG_INTERVAL_MS 5000    // Debug: print voltages every 5 seconds

// Debug Configuration
#define DEBUG_ENABLE 0                  // Enable debug output (0=disabled, 1=enabled)

// Sensor Pinout
#define ADC_NTC0 26
#define ADC_NTC1 27
#define ADC_FB_M 28
#define GPIO_FB_S0 20
#define GPIO_FB_S1 21
#define GPIO_FB_S2 22

#define I2C_PORT i2c0
#define I2C_SDA 4
#define I2C_SCL 5
#define I2C_FREQ 400000

// INA226 Configuration
#define INA226_ADDR 0x40
#define INA226_REG_CONFIG 0x00
#define INA226_REG_SHUNT_V 0x01
#define INA226_REG_BUS_V 0x02
#define INA226_REG_CURRENT 0x04
#define INA226_REG_CALIBRATION 0x05

// NTC Configuration
#define NTC_SERIES_R 10000.0f
#define NTC_NOMINAL_R 10000.0f
#define NTC_NOMINAL_T 25.0f
#define NTC_BETA 3950.0f
#define ADC_VREF 3.3f
#define ADC_MAX 4095.0f

// LED Configuration
#define GPIO_LED0 2  // Primary status LED (green)
#define GPIO_LED1 3  // Secondary status LED (fault indicator, red)

// Button Configuration (hardware debounced with caps)
#define GPIO_BUTTON0 6  // Primary button (reset)
#define GPIO_BUTTON1 7  // Secondary button (cycle patterns)

// Protocol Commands
#define CMD_UPDATE_AND_FLUSH 0xFF
#define CMD_UPDATE_ONLY 0xFE
#define CMD_FLUSH 0xFD
#define CMD_RESET 0xFC
#define CMD_START_PATTERN 0xFB
#define CMD_STOP_PATTERN 0xFA
#define CMD_CLEAR_ALL 0xF9

// Color Constants (R, G, B)
#define COLOR_RED       255, 0, 0
#define COLOR_GREEN     0, 255, 0
#define COLOR_BLUE      0, 0, 255
#define COLOR_CYAN      0, 255, 255
#define COLOR_MAGENTA   255, 0, 255
#define COLOR_YELLOW    255, 255, 0
#define COLOR_WHITE     255, 255, 255
#define COLOR_BLACK     0, 0, 0
#define COLOR_LIGHT_RED 255, 128, 128
#define COLOR_LIGHT_BLUE 128, 128, 255

// ============================================================================
// Debug Helper
// ============================================================================

static inline void debug_printf(const char *format, ...) {
#if DEBUG_ENABLE
    va_list args;
    va_start(args, format);
    vprintf(format, args);
    va_end(args);
#else
    (void)format;  // Suppress unused parameter warning
#endif
}

// ============================================================================
// Data Structures
// ============================================================================

// Channel state
typedef struct {
    PIO pio;
    uint sm;
    uint pin;

    // Double buffering for DMA
    uint32_t buffer_a[MAX_LEDS_PER_CHANNEL];
    uint32_t buffer_b[MAX_LEDS_PER_CHANNEL];
    uint32_t *active_buffer;   // Buffer being written to by USB/parser
    uint32_t *output_buffer;   // Buffer being read by DMA

    int dma_channel;
    bool dma_in_progress;

    uint16_t led_count;
    uint32_t current_limit_events;
    bool tripped;
    uint32_t trip_count;
} ws2812_channel_t;

// Parser state
typedef enum {
    STATE_WAIT_COMMAND,
    STATE_READ_CHANNEL,
    STATE_READ_COUNT_LOW,
    STATE_READ_COUNT_HIGH,
    STATE_READ_RGB_DATA,
    STATE_READ_FLUSH_MASK,
    STATE_READ_PATTERN_ID
} parser_state_t;

// Parser context
typedef struct {
    parser_state_t state;
    uint8_t current_command;
    uint8_t current_channel;
    uint16_t current_led_count;
    uint16_t current_led_index;
    uint8_t rgb_byte_index;
    uint8_t current_r, current_g, current_b;
    bool auto_flush;
} parser_context_t;

// Sensor data
typedef struct {
    float temp0;
    float temp1;
    float voltage;
    float current;
    uint8_t fb_mask;
    float fb_voltages[NUM_CHANNELS];
    bool ina226_present;
} sensor_data_t;

// Statistics
typedef struct {
    uint32_t commands;
    uint32_t pixels;
    uint32_t flushes;
    uint32_t errors;
} statistics_t;

// System mode
typedef enum {
    MODE_NORMAL,
    MODE_TEST_PATTERN
} system_mode_t;

// ============================================================================
// Global Variables
// ============================================================================

static ws2812_channel_t channels[NUM_CHANNELS];
static uint8_t gamma_lut[256];

#define UART_BUFFER_SIZE 5120
static uint8_t uart_rx_buffer[UART_BUFFER_SIZE];
static volatile uint16_t uart_rx_count = 0;

// Parser state (grouped into struct)
static parser_context_t parser = {
    .state = STATE_WAIT_COMMAND,
    .current_command = 0,
    .current_channel = 0,
    .current_led_count = 0,
    .current_led_index = 0,
    .rgb_byte_index = 0,
    .current_r = 0,
    .current_g = 0,
    .current_b = 0,
    .auto_flush = true
};

// System state
static system_mode_t system_mode = MODE_NORMAL;
static uint8_t current_test_pattern = 0;
static absolute_time_t last_serial_data_time;
static absolute_time_t boot_time;
static absolute_time_t pattern_start_time;

// Test pattern animation state - pre-computed sine table for efficiency
#define SINE_TABLE_SIZE 512
static uint16_t sine_table[SINE_TABLE_SIZE];  // One sine cycle, centered at 32768

// Statistics (grouped into struct)
static statistics_t stats = {
    .commands = 0,
    .pixels = 0,
    .flushes = 0,
    .errors = 0
};

// Sensor data (grouped into struct)
static sensor_data_t sensors = {
    .temp0 = 0.0f,
    .temp1 = 0.0f,
    .voltage = 0.0f,
    .current = 0.0f,
    .fb_mask = 0xFF,
    .fb_voltages = {0},
    .ina226_present = false
};

// Fault tracking
static bool fault_present = false;
static bool fault_history = false;

// ============================================================================
// Gamma Correction
// ============================================================================

static void calc_gamma_table(float gamma) {
#if GAMMA_CORRECTION_ENABLE
    gamma_lut[0] = 0;
    for (uint16_t i = 1; i < 256; i++) {
        float normalized = (float)i / 255.0f;
        float corrected = powf(normalized, gamma);
        gamma_lut[i] = (uint8_t)(corrected * 255.0f + 0.5f);
    }
#else
    for (uint16_t i = 0; i < 256; i++) {
        gamma_lut[i] = i;
    }
#endif
}

static inline uint8_t gamma_correct(uint8_t value) {
    return gamma_lut[value];
}

static inline uint32_t rgb_to_grb(uint8_t r, uint8_t g, uint8_t b) {
    r = gamma_correct(r);
    g = gamma_correct(g);
    b = gamma_correct(b);
    // Store pre-shifted for DMA (PIO expects data in bits [31:8])
    return (((uint32_t)(g) << 16) | ((uint32_t)(r) << 8) | (uint32_t)(b)) << 8;
}

// ============================================================================
// Current Limiting
// ============================================================================

static uint32_t calculate_brightness_units(uint32_t grb_pixel_shifted) {
    // Data is pre-shifted by 8, so shift right to extract
    uint32_t grb_pixel = grb_pixel_shifted >> 8;
    uint8_t g = (grb_pixel >> 16) & 0xFF;
    uint8_t r = (grb_pixel >> 8) & 0xFF;
    uint8_t b = grb_pixel & 0xFF;
    return (uint32_t)r + (uint32_t)g + (uint32_t)b;
}

static void apply_current_limiting(uint8_t channel_id) {
#if CURRENT_LIMIT_ENABLE
    ws2812_channel_t *ch = &channels[channel_id];

    if (ch->led_count == 0) return;

    // Calculate total brightness from active buffer
    uint32_t total_brightness = 0;
    for (uint16_t i = 0; i < ch->led_count; i++) {
        total_brightness += calculate_brightness_units(ch->active_buffer[i]);
    }

    // Check if limiting needed
    if (total_brightness > CURRENT_LIMIT_THRESHOLD) {
        float scale = (float)CURRENT_LIMIT_THRESHOLD / (float)total_brightness;

        // Scale all pixels in active buffer (data is pre-shifted)
        for (uint16_t i = 0; i < ch->led_count; i++) {
            uint32_t pixel_shifted = ch->active_buffer[i];
            uint32_t pixel = pixel_shifted >> 8;  // Unshift to extract RGB
            uint8_t g = (pixel >> 16) & 0xFF;
            uint8_t r = (pixel >> 8) & 0xFF;
            uint8_t b = pixel & 0xFF;

            g = (uint8_t)(g * scale);
            r = (uint8_t)(r * scale);
            b = (uint8_t)(b * scale);

            // Store back pre-shifted
            ch->active_buffer[i] = (((uint32_t)g << 16) | ((uint32_t)r << 8) | (uint32_t)b) << 8;
        }

        ch->current_limit_events++;
    }
#endif
}

// ============================================================================
// WS2812 Channel Management
// ============================================================================

static void ws2812_channel_init(uint8_t channel_id) {
    ws2812_channel_t *ch = &channels[channel_id];

    ch->pin = WS2812_PIN_BASE + channel_id;
    ch->led_count = 0;
    ch->current_limit_events = 0;
    ch->tripped = false;
    ch->trip_count = 0;

    // Initialize double buffering
    ch->active_buffer = ch->buffer_a;  // Start with buffer A as active
    ch->output_buffer = ch->buffer_b;  // Buffer B will be used for first DMA
    memset(ch->buffer_a, 0, sizeof(ch->buffer_a));
    memset(ch->buffer_b, 0, sizeof(ch->buffer_b));

    // Allocate DMA channel
    ch->dma_channel = dma_claim_unused_channel(true);
    ch->dma_in_progress = false;

    // Distribute channels across both PIO blocks (4 per PIO)
    if (channel_id < 4) {
        ch->pio = pio0;
        ch->sm = channel_id;
    } else {
        ch->pio = pio1;
        ch->sm = channel_id - 4;
    }

    // Load program if not already loaded
    static bool pio0_loaded = false;
    static bool pio1_loaded = false;
    static uint pio0_offset = 0;
    static uint pio1_offset = 0;

    if (ch->pio == pio0 && !pio0_loaded) {
        pio0_offset = pio_add_program(pio0, &ws2812_program);
        pio0_loaded = true;
    } else if (ch->pio == pio1 && !pio1_loaded) {
        pio1_offset = pio_add_program(pio1, &ws2812_program);
        pio1_loaded = true;
    }

    uint offset = (ch->pio == pio0) ? pio0_offset : pio1_offset;

    // Initialize the PIO program for this channel
    ws2812_program_init(ch->pio, ch->sm, offset, ch->pin, 800000, false);

    // Configure DMA channel
    dma_channel_config dma_cfg = dma_channel_get_default_config(ch->dma_channel);
    channel_config_set_transfer_data_size(&dma_cfg, DMA_SIZE_32);   // 32-bit transfers
    channel_config_set_read_increment(&dma_cfg, true);              // Increment read address
    channel_config_set_write_increment(&dma_cfg, false);            // Fixed write (PIO FIFO)
    channel_config_set_dreq(&dma_cfg, pio_get_dreq(ch->pio, ch->sm, true));  // PIO TX DREQ

    // Configure DMA (will be started later with actual buffer)
    dma_channel_configure(
        ch->dma_channel,
        &dma_cfg,
        &ch->pio->txf[ch->sm],   // Write to PIO TX FIFO
        NULL,                    // Read from buffer (set on each transfer)
        0,                       // Transfer count (set on each transfer)
        false                    // Don't start yet
    );
}

static void ws2812_channel_update(uint8_t channel_id) {
    ws2812_channel_t *ch = &channels[channel_id];

    if (ch->led_count == 0) return;

    // Wait for any in-progress DMA to complete
    if (ch->dma_in_progress) {
        dma_channel_wait_for_finish_blocking(ch->dma_channel);
        ch->dma_in_progress = false;
    }

    // Swap buffers: active becomes output, output becomes active
    uint32_t *temp = ch->active_buffer;
    ch->active_buffer = ch->output_buffer;
    ch->output_buffer = temp;

    // Start DMA transfer from output buffer (which has the data we just finished writing)
    // Note: Data is pre-shifted, so we can DMA directly to PIO FIFO
    dma_channel_transfer_from_buffer_now(
        ch->dma_channel,
        ch->output_buffer,
        ch->led_count
    );

    ch->dma_in_progress = true;

    // TODO: clear/zero the active buffer
    stats.flushes++;
}

static void flush_channels(uint8_t channel_mask) {
    for (uint8_t i = 0; i < NUM_CHANNELS; i++) {
        if (channel_mask & (1 << i)) {
            ws2812_channel_update(i);
        }
    }
}

// ============================================================================
// Sensor Reading Functions
// ============================================================================

static bool ina226_write_reg(uint8_t reg, uint16_t value) {
    uint8_t buf[3] = {reg, (value >> 8) & 0xFF, value & 0xFF};
    return i2c_write_blocking(I2C_PORT, INA226_ADDR, buf, 3, false) == 3;
}

static bool ina226_read_reg(uint8_t reg, uint16_t *value) {
    uint8_t buf[2];
    if (i2c_write_blocking(I2C_PORT, INA226_ADDR, &reg, 1, true) != 1) return false;
    if (i2c_read_blocking(I2C_PORT, INA226_ADDR, buf, 2, false) != 2) return false;
    *value = (buf[0] << 8) | buf[1];
    return true;
}

static bool ina226_init(void) {
    // Reset device
    if (!ina226_write_reg(INA226_REG_CONFIG, 0x8000)) return false;
    sleep_ms(10);

    // Configure: continuous mode
    uint16_t config = 0x4127;  // AVG=1, VBUSCT=1.1ms, VSHCT=1.1ms, continuous
    if (!ina226_write_reg(INA226_REG_CONFIG, config)) return false;

    // Set calibration (16A max, 2.5mOhm shunt)
    if (!ina226_write_reg(INA226_REG_CALIBRATION, 4194)) return false;

    return true;
}

static float ina226_read_bus_voltage(void) {
    uint16_t raw;
    if (!ina226_read_reg(INA226_REG_BUS_V, &raw)) return -999.0f;
    return (raw * 1.25f) / 1000.0f;  // Convert to V
}

static float ina226_read_current(void) {
    uint16_t raw;
    if (!ina226_read_reg(INA226_REG_CURRENT, &raw)) return -999.0f;
    int16_t signed_val = (int16_t)raw;
    return (signed_val * 0.48828f) / 1000.0f;  // Convert to A
}

static float adc_to_voltage(uint16_t adc_val) {
    return (adc_val * ADC_VREF) / ADC_MAX;
}

static float ntc_to_temperature(float v_ntc) {
    if (v_ntc >= ADC_VREF) return -999.0f;
    float r_ntc = (v_ntc * NTC_SERIES_R) / (ADC_VREF - v_ntc);
    float t_kelvin = 1.0f / ((1.0f / (NTC_NOMINAL_T + 273.15f)) +
                             (1.0f / NTC_BETA) * logf(r_ntc / NTC_NOMINAL_R));
    return t_kelvin - 273.15f;
}

static float read_ntc_temperature(uint8_t ntc_num) {
    adc_select_input(ntc_num);

    // Take multiple samples and average for noise reduction
    uint32_t adc_sum = 0;
    const uint8_t num_samples = 8;

    for (uint8_t i = 0; i < num_samples; i++) {
        adc_sum += adc_read();
    }

    uint16_t adc_avg = adc_sum / num_samples;
    float voltage = adc_to_voltage(adc_avg);
    return ntc_to_temperature(voltage);
}

static void set_mux_channel(uint8_t channel) {
    gpio_put(GPIO_FB_S0, channel & 0x01);
    gpio_put(GPIO_FB_S1, (channel >> 1) & 0x01);
    gpio_put(GPIO_FB_S2, (channel >> 2) & 0x01);
    // No sleep - let it settle naturally between main loop iterations
}

static void update_sensors(void) {
    static uint8_t fb_channel_idx = 0;
    static uint8_t sensor_cycle_counter = 0;
    static absolute_time_t last_update = 0;

    // Rate limit sensor updates
    absolute_time_t now = get_absolute_time();
    int64_t elapsed_us = absolute_time_diff_us(last_update, now);
    if (elapsed_us < SENSOR_UPDATE_INTERVAL_US) return;
    last_update = now;

    // Read one feedback channel per update (spreads load, allows settling)
    adc_select_input(2);  // GPIO 28 - feedback mux output
    uint32_t adc_sum = 0;
    const uint8_t num_samples = 4;

    // Take multiple ADC samples and average for noise reduction
    for (uint8_t i = 0; i < num_samples; i++) {
        adc_sum += adc_read();
    }

    uint16_t adc_avg = adc_sum / num_samples;
    float voltage = adc_to_voltage(adc_avg);
    sensors.fb_voltages[fb_channel_idx] = voltage;

    // Check trip state for this channel
    bool active = (voltage > FAULT_VOLTAGE_THRESHOLD);

    if (active) {
        sensors.fb_mask |= (1 << fb_channel_idx);
        if (channels[fb_channel_idx].tripped) {
            channels[fb_channel_idx].tripped = false;  // Recovered
            printf("Channel %d recovered (voltage: %.3fV)\n", fb_channel_idx, voltage);
        }
    } else {
        sensors.fb_mask &= ~(1 << fb_channel_idx);
        if (!channels[fb_channel_idx].tripped) {
            channels[fb_channel_idx].tripped = true;
            channels[fb_channel_idx].trip_count++;
            printf("Channel %d TRIPPED! (voltage: %.3fV, threshold: %.2fV)\n",
                   fb_channel_idx, voltage, FAULT_VOLTAGE_THRESHOLD);
        }
    }

    // Move to next channel
    fb_channel_idx = (fb_channel_idx + 1) % NUM_CHANNELS;
    set_mux_channel(fb_channel_idx);

    // Read NTC temperatures less frequently (~1Hz)
    // Stagger the readings to spread CPU load
    if (sensor_cycle_counter == 0) {
        sensors.temp0 = read_ntc_temperature(0);
    } else if (sensor_cycle_counter == 10) {
        sensors.temp1 = read_ntc_temperature(1);
    }

    // Read INA226 at ~4Hz
    if (sensors.ina226_present && (sensor_cycle_counter % 5) == 2) {
        sensors.voltage = ina226_read_bus_voltage();
        sensors.current = ina226_read_current();
    }

    sensor_cycle_counter = (sensor_cycle_counter + 1) % 20;
}

// ============================================================================
// Test Patterns
// ============================================================================

// Channel identification colors (high saturation, easily distinguishable)
static const uint8_t test_pattern_colors[8][3] = {
    {COLOR_RED},       // Ch0: Red
    {COLOR_GREEN},     // Ch1: Green
    {COLOR_BLUE},      // Ch2: Blue
    {COLOR_CYAN},      // Ch3: Cyan
    {COLOR_MAGENTA},   // Ch4: Magenta
    {COLOR_YELLOW},    // Ch5: Yellow
    {COLOR_LIGHT_RED}, // Ch6: Light Red
    {COLOR_LIGHT_BLUE} // Ch7: Light Blue
};

// Ternary encoding for pattern 4 (camera calibration)
#define TERNARY_NUM_DIGITS 9
#define TERNARY_TOTAL_LEDS (NUM_CHANNELS * TEST_PATTERN_DEFAULT_LEDS)  // 1600 LEDs

// Ternary digit colors (for pattern 4)
static const uint8_t ternary_colors[3][3] = {
    {COLOR_RED},   // 0: Red
    {COLOR_GREEN}, // 1: Green
    {COLOR_BLUE}   // 2: Blue
};

/**
 * Initialize pre-computed sine table for pattern animations
 * Called once at startup
 */
static void init_sine_table(void) {
    for (uint16_t i = 0; i < SINE_TABLE_SIZE; i++) {
        float angle = (float)i * 6.28318f / (float)SINE_TABLE_SIZE;  // 0 to 2*PI
        float sine_val = sinf(angle);  // -1 to 1
        float brightness = 0.3f + 0.7f * (sine_val * 0.5f + 0.5f);  // 0.3 to 1.0
        sine_table[i] = (uint16_t)(brightness * 32768.0f);
    }
}

/**
 * Initialize test pattern (called when pattern is activated)
 */
static void activate_test_pattern(uint8_t pattern_id) {
    pattern_id = pattern_id % NUM_TEST_PATTERNS;  // Wrap around

    // Set LED count for all channels
    for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
        channels[ch].led_count = TEST_PATTERN_DEFAULT_LEDS;
    }

    system_mode = MODE_TEST_PATTERN;
    current_test_pattern = pattern_id;
    pattern_start_time = get_absolute_time();
    printf("Test pattern %d activated\n", pattern_id);
}

/**
 * Encode LED ID into ternary with checksum
 * Returns the ternary digit at the specified position (0 = least significant)
 * Algorithm from udp_multistring_oneshot.py:
 *   n = led_id * 9
 *   n = n + (7 - (n % 7))  // Add checksum to make divisible by 7
 *   Convert to base-3 representation
 */
static uint8_t get_ternary_digit(uint16_t led_id, uint8_t digit_pos) {
    // Encode: multiply by 9 and add checksum
    uint32_t n = led_id * 9;
    n = n + (7 - (n % 7));  // Checksum: make divisible by 7

    // Extract the digit at digit_pos by repeatedly dividing by 3
    for (uint8_t i = 0; i < digit_pos; i++) {
        n /= 3;
    }

    return n % 3;  // Return the digit (0, 1, or 2)
}

/**
 * Update animated test patterns (maintains 30Hz rate internally)
 */
static void update_test_pattern(void) {
    static uint32_t frame_counter = 0;
    static absolute_time_t last_update = 0;

    if (system_mode != MODE_TEST_PATTERN) return;

    // Rate limit to 30Hz for consistent animation timing
    absolute_time_t now = get_absolute_time();
    int64_t elapsed_us = absolute_time_diff_us(last_update, now);
    if (elapsed_us < PATTERN_UPDATE_INTERVAL_US) return;
    last_update = now;

    frame_counter++;

    switch (current_test_pattern) {
        case PATTERN_CHANNEL_ID: {
            // Pattern 0: Channel identification with minimal power
            // - Only first N and last N LEDs are lit (N = channel number 1-8)
            // - First N LEDs blink in channel color when blink_state is true
            // - Last N LEDs blink in channel color when blink_state is false
            // - All other LEDs are OFF to minimize power consumption

            bool blink_state = (frame_counter / 15) & 1;  // Toggle every 15 frames (0.5s at 30Hz) = 1Hz full cycle

            for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
                uint8_t num_ident_leds = ch + 1;  // 1-8 LEDs for channel identification

                for (uint16_t i = 0; i < channels[ch].led_count; i++) {
                    uint8_t r, g, b;

                    // First N and last N LEDs alternate in channel color
                    bool is_first = (i < num_ident_leds);
                    bool is_last = (i >= (channels[ch].led_count - num_ident_leds));

                    if (is_first) {
                        // First N LEDs: channel color when blink_state true, off otherwise
                        if (blink_state) {
                            r = test_pattern_colors[ch][0];
                            g = test_pattern_colors[ch][1];
                            b = test_pattern_colors[ch][2];
                        } else {
                            r = g = b = 0;  // Off
                        }
                    } else if (is_last) {
                        // Last N LEDs: channel color when blink_state false, off otherwise
                        if (!blink_state) {
                            r = test_pattern_colors[ch][0];
                            g = test_pattern_colors[ch][1];
                            b = test_pattern_colors[ch][2];
                        } else {
                            r = g = b = 0;  // Off
                        }
                    } else {
                        // Middle LEDs: always OFF to minimize power
                        r = g = b = 0;
                    }

                    channels[ch].active_buffer[i] = rgb_to_grb(r, g, b);
                }

                // Apply current limiting and flush
                apply_current_limiting(ch);
                ws2812_channel_update(ch);
            }
            break;
        }

        case PATTERN_RGB_CYCLE: {
            // Pattern 1: Cycle through Red, Green, Blue (1 Hz)
            // At 30Hz: 30 frames per color = 1s per color
            int phase = (frame_counter / 30) % 3;
            uint8_t r = (phase == 0) ? 255 : 0;
            uint8_t g = (phase == 1) ? 255 : 0;
            uint8_t b = (phase == 2) ? 255 : 0;

            uint32_t pixel = rgb_to_grb(r, g, b);

            for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
                for (uint16_t i = 0; i < channels[ch].led_count; i++) {
                    channels[ch].active_buffer[i] = pixel;
                }

                apply_current_limiting(ch);
                ws2812_channel_update(ch);
            }
            break;
        }

        case PATTERN_COLOR_CYCLE: {
            // Pattern 2: Cycle through R, G, B, C, M, Y, W, Black (1 Hz per color)
            static const uint8_t colors[8][3] = {
                {COLOR_RED},     // Red
                {COLOR_GREEN},   // Green
                {COLOR_BLUE},    // Blue
                {COLOR_CYAN},    // Cyan
                {COLOR_MAGENTA}, // Magenta
                {COLOR_YELLOW},  // Yellow
                {COLOR_WHITE},   // White
                {COLOR_BLACK}    // Black
            };

            int phase = (frame_counter / 30) % 8;  // 30 frames per color at 30Hz = 1s per color
            uint8_t r = colors[phase][0];
            uint8_t g = colors[phase][1];
            uint8_t b = colors[phase][2];

            uint32_t pixel = rgb_to_grb(r, g, b);

            for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
                for (uint16_t i = 0; i < channels[ch].led_count; i++) {
                    channels[ch].active_buffer[i] = pixel;
                }

                apply_current_limiting(ch);
                ws2812_channel_update(ch);
            }
            break;
        }

        case PATTERN_END_BLINK: {
            // Pattern 3: Alternating red blink on first and last LED (1 Hz)
            bool blink_state = (frame_counter / 15) % 2;  // Toggle every 15 frames (0.5s at 30Hz) = 1Hz full cycle

            uint32_t red_pixel = rgb_to_grb(255, 0, 0);
            uint32_t black_pixel = rgb_to_grb(0, 0, 0);

            for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
                for (uint16_t i = 0; i < channels[ch].led_count; i++) {
                    if (i == 0) {
                        // First LED: blink with state
                        channels[ch].active_buffer[i] = blink_state ? red_pixel : black_pixel;
                    } else if (i == channels[ch].led_count - 1) {
                        // Last LED: blink opposite to first
                        channels[ch].active_buffer[i] = blink_state ? black_pixel : red_pixel;
                    } else {
                        // All other LEDs: off
                        channels[ch].active_buffer[i] = black_pixel;
                    }
                }

                apply_current_limiting(ch);
                ws2812_channel_update(ch);
            }
            break;
        }

        case PATTERN_TERNARY: {
            // Pattern 4: Ternary encoding for camera calibration
            // Each LED displays a unique ternary pattern based on its global ID
            // Global ID = channel * 200 + local_led_index
            // Pattern sequence (each frame held for 6 frames @ 30Hz = 0.2s):
            //   Frame 0: Black
            //   Frame 1: Magenta (sync marker)
            //   Frame 2: Black
            //   Frames 3-20: 9 digit frames, each followed by black frame

            const uint8_t frames_per_state = 6;  // 0.2s at 30Hz
            const uint8_t total_frames = 3 + (TERNARY_NUM_DIGITS * 2);  // 21 frames total
            uint8_t cycle_frame = (frame_counter / frames_per_state) % total_frames;

            uint32_t black_pixel = rgb_to_grb(0, 0, 0);
            uint32_t magenta_pixel = rgb_to_grb(255, 0, 255);  // Sync marker

            for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
                for (uint16_t i = 0; i < channels[ch].led_count; i++) {
                    uint32_t pixel;

                    if (cycle_frame == 0 || cycle_frame == 2) {
                        // Black frame (frame 0 and 2)
                        pixel = black_pixel;
                    } else if (cycle_frame == 1) {
                        // Magenta sync marker (frame 1)
                        pixel = magenta_pixel;
                    } else {
                        // Digit frames (3-20)
                        uint8_t digit_frame = cycle_frame - 3;

                        if (digit_frame % 2 == 0) {
                            // Even frames (0, 2, 4, ..., 16) show digit
                            uint8_t digit_index = digit_frame / 2;

                            // Calculate global LED ID
                            uint16_t global_led_id = ch * TEST_PATTERN_DEFAULT_LEDS + i;

                            // Get ternary digit for this LED and position
                            uint8_t digit = get_ternary_digit(global_led_id, digit_index);

                            // Map digit to color (0=Red, 1=Green, 2=Blue)
                            pixel = rgb_to_grb(
                                ternary_colors[digit][0],
                                ternary_colors[digit][1],
                                ternary_colors[digit][2]
                            );
                        } else {
                            // Odd frames show black (spacing between digits)
                            pixel = black_pixel;
                        }
                    }

                    channels[ch].active_buffer[i] = pixel;
                }

                apply_current_limiting(ch);
                ws2812_channel_update(ch);
            }
            break;
        }

        case PATTERN_COLORFUL_TWINKLE: {
            // Pattern 5: Colorful twinkling effect
            // - Each channel shows its unique color
            // - All LEDs twinkle with sine wave brightness modulation
            // - No identification blinking, just smooth twinkling

            for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
                for (uint16_t i = 0; i < channels[ch].led_count; i++) {
                    // Pick random offset and speed based on LED position (deterministic)
                    uint16_t seed = (ch * 37 + i * 73);
                    uint16_t phase_offset = (seed * 17) % SINE_TABLE_SIZE;
                    uint16_t speed = (seed % 7) + 1;  // Speed 1-7

                    // Look up sine value and multiply with channel color
                    uint16_t position = (frame_counter * speed + phase_offset) % SINE_TABLE_SIZE;
                    uint16_t brightness = sine_table[position];

                    // Multiply color by brightness (centered at 32768)
                    uint8_t r = (test_pattern_colors[ch][0] * brightness) >> 15;
                    uint8_t g = (test_pattern_colors[ch][1] * brightness) >> 15;
                    uint8_t b = (test_pattern_colors[ch][2] * brightness) >> 15;

                    channels[ch].active_buffer[i] = rgb_to_grb(r, g, b);
                }

                // Apply current limiting and flush
                apply_current_limiting(ch);
                ws2812_channel_update(ch);
            }
            break;
        }
    }
}

static void stop_test_pattern(void) {
    system_mode = MODE_NORMAL;
}

// ============================================================================
// UART and Protocol Parsing
// ============================================================================

extern int stdio_usb_in_chars(char *buf, int length);

static int read_usb_data() {
    uint16_t count = uart_rx_count;

    // Calculate available space in buffer
    uint16_t space = UART_BUFFER_SIZE - count;

    if (space == 0) {
        debug_printf("[USB] buffer full\n");
        return 0;
    }

    debug_printf("[USB] count=%u space=%u\n", count, space);

    // Read into buffer at current position
    int rc = stdio_usb_in_chars((char*) &uart_rx_buffer[count], space);
    if (rc > 0) {
        uart_rx_count = count + rc;
        debug_printf("[USB] read %d chars, count=%u\n", rc, uart_rx_count);
    }
    return rc;
}

static void parse_uart_data() {
    // Read USB data multiple times to maximize throughput
    for (int read_attempts = 0; read_attempts < 16; read_attempts++) {
        int rc = read_usb_data();
        if (rc == 0) break;
    }

    // Process all bytes in buffer
    uint16_t count = uart_rx_count;
    for (uint16_t i = 0; i < count; i++) {
        uint8_t byte = uart_rx_buffer[i];

        // Update last data time
        last_serial_data_time = get_absolute_time();

        debug_printf("[UART] State=%d Byte=0x%02X\n", parser.state, byte);

        switch (parser.state) {
            case STATE_WAIT_COMMAND:
                parser.current_command = byte;
                stats.commands++;

                if (byte == CMD_UPDATE_AND_FLUSH) {
                    debug_printf("[UART] CMD_UPDATE_AND_FLUSH\n");
                    parser.auto_flush = true;
                    parser.state = STATE_READ_CHANNEL;
                } else if (byte == CMD_UPDATE_ONLY) {
                    debug_printf("[UART] CMD_UPDATE_ONLY\n");
                    parser.auto_flush = false;
                    parser.state = STATE_READ_CHANNEL;
                } else if (byte == CMD_FLUSH) {
                    debug_printf("[UART] CMD_FLUSH\n");
                    parser.state = STATE_READ_FLUSH_MASK;
                } else if (byte == CMD_RESET) {
                    debug_printf("[UART] CMD_RESET\n");
                    watchdog_reboot(0, 0, 0);
                } else if (byte == CMD_START_PATTERN) {
                    debug_printf("[UART] CMD_START_PATTERN\n");
                    parser.state = STATE_READ_PATTERN_ID;
                } else if (byte == CMD_STOP_PATTERN) {
                    debug_printf("[UART] CMD_STOP_PATTERN\n");
                    stop_test_pattern();
                } else if (byte == CMD_CLEAR_ALL) {
                    debug_printf("[UART] CMD_CLEAR_ALL\n");
                    // Also stop any test pattern
                    stop_test_pattern();
                    // Clear all channels - set to black and flush
                    for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
                        channels[ch].led_count = MAX_LEDS_PER_CHANNEL;
                        memset(channels[ch].active_buffer, 0, sizeof(channels[ch].buffer_a));
                        ws2812_channel_update(ch);
                    }
                }
                break;

            case STATE_READ_PATTERN_ID:
                debug_printf("[UART] Pattern ID=%d\n", byte);
                activate_test_pattern(byte);
                parser.state = STATE_WAIT_COMMAND;
                break;

            case STATE_READ_FLUSH_MASK:
                debug_printf("[UART] Flush mask=0x%02X\n", byte);
                flush_channels(byte);  // DMA-based non-blocking
                parser.state = STATE_WAIT_COMMAND;
                break;

            case STATE_READ_CHANNEL:
                if (byte < NUM_CHANNELS) {
                    debug_printf("[UART] Channel=%d\n", byte);
                    parser.current_channel = byte;
                    parser.state = STATE_READ_COUNT_LOW;
                } else {
                    debug_printf("[UART] ERROR: Invalid channel %d\n", byte);
                    stats.errors++;
                    parser.state = STATE_WAIT_COMMAND;
                }
                break;

            case STATE_READ_COUNT_LOW:
                debug_printf("[UART] Count low=0x%02X\n", byte);
                parser.current_led_count = byte;
                parser.state = STATE_READ_COUNT_HIGH;
                break;

            case STATE_READ_COUNT_HIGH:
                parser.current_led_count |= (uint16_t)byte << 8;
                debug_printf("[UART] Count high=0x%02X, Total count=%d\n", byte, parser.current_led_count);

                if (parser.current_led_count > 0 && parser.current_led_count <= MAX_LEDS_PER_CHANNEL) {
                    parser.current_led_index = 0;
                    parser.rgb_byte_index = 0;
                    parser.state = STATE_READ_RGB_DATA;
                    channels[parser.current_channel].led_count = parser.current_led_count;

                    // Exit test pattern mode if active
                    if (system_mode == MODE_TEST_PATTERN) {
                        debug_printf("[UART] Exiting test pattern mode\n");
                        system_mode = MODE_NORMAL;
                    }
                } else {
                    debug_printf("[UART] ERROR: Invalid LED count %d\n", parser.current_led_count);
                    stats.errors++;
                    parser.state = STATE_WAIT_COMMAND;
                }
                break;

            case STATE_READ_RGB_DATA:
                if (parser.rgb_byte_index == 0) {
                    parser.current_r = byte;
                    parser.rgb_byte_index++;
                } else if (parser.rgb_byte_index == 1) {
                    parser.current_g = byte;
                    parser.rgb_byte_index++;
                } else if (parser.rgb_byte_index == 2) {
                    parser.current_b = byte;

                    // Write to active buffer (gamma correction happens in rgb_to_grb)
                    channels[parser.current_channel].active_buffer[parser.current_led_index] =
                        rgb_to_grb(parser.current_r, parser.current_g, parser.current_b);

                    parser.current_led_index++;
                    parser.rgb_byte_index = 0;
                    stats.pixels++;

                    if (parser.current_led_index <= 2 || parser.current_led_index >= parser.current_led_count) {
                        debug_printf("[UART] LED[%d] R=%d G=%d B=%d\n", parser.current_led_index - 1, parser.current_r, parser.current_g, parser.current_b);
                    }

                    if (parser.current_led_index >= parser.current_led_count) {
                        debug_printf("[UART] Frame complete, flushing=%d\n", parser.auto_flush);
                        // Apply current limiting before flush
                        apply_current_limiting(parser.current_channel);

                        if (parser.auto_flush) {
                            ws2812_channel_update(parser.current_channel);  // DMA-based non-blocking
                        }

                        parser.state = STATE_WAIT_COMMAND;
                    }
                }
                break;
        }
    }

    // Reset buffer after processing all data
    // The state machine maintains state across calls, so we don't need to preserve data
    uart_rx_count = 0;
}

// ============================================================================
// Status Reporting
// ============================================================================

static void print_status_report(void) {
    static absolute_time_t last_report = 0;
    static absolute_time_t last_debug = 0;

    absolute_time_t now = get_absolute_time();
    int64_t elapsed = absolute_time_diff_us(last_report, now);
    int64_t elapsed_debug = absolute_time_diff_us(last_debug, now);

    if (elapsed >= STATUS_REPORT_INTERVAL_MS * 1000) {
        uint32_t uptime_sec = absolute_time_diff_us(boot_time, now) / 1000000;

        // Calculate total trip and limit events
        uint32_t total_trips = 0;
        uint32_t total_limits = 0;
        for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
            total_trips += channels[ch].trip_count;
            total_limits += channels[ch].current_limit_events;
        }

        // Check for faults using configurable thresholds
        fault_present = false;
        if (sensors.temp0 > FAULT_TEMP_THRESHOLD || sensors.temp1 > FAULT_TEMP_THRESHOLD) {
            fault_present = true;  // Overtemp
        }
        if (sensors.current > FAULT_CURRENT_THRESHOLD) {
            fault_present = true;  // Overcurrent
        }
        if (sensors.fb_mask != 0xFF) {
            fault_present = true;  // Channel trip
        }

        if (fault_present) fault_history = true;

        printf("STATS up=%lu cmd=%lu pix=%lu flush=%lu err=%lu t0=%.1f t1=%.1f v=%.2f i=%.2f fb=%02X trip=%lu lim=%lu mode=%d\n",
               uptime_sec, stats.commands, stats.pixels, stats.flushes, stats.errors,
               sensors.temp0, sensors.temp1, sensors.voltage, sensors.current,
               sensors.fb_mask, total_trips, total_limits, system_mode);

        last_report = now;
    }

    // Debug output: print channel voltages periodically
    if (elapsed_debug >= FAULT_DEBUG_INTERVAL_MS * 1000) {
        debug_printf("DEBUG_FB_VOLTAGES: ");
        for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
            debug_printf("ch%d=%.3fV ", ch, sensors.fb_voltages[ch]);
        }
        debug_printf("(threshold=%.2fV)\n", FAULT_VOLTAGE_THRESHOLD);
        last_debug = now;
    }
}

// ============================================================================
// LED Status Indicators
// ============================================================================

static void update_status_leds(void) {
    static absolute_time_t last_led0_update = 0;
    static absolute_time_t last_led1_update = 0;
    static bool led0_state = false;
    static bool led1_state = false;

    absolute_time_t now = get_absolute_time();
    int64_t elapsed0 = absolute_time_diff_us(last_led0_update, now);
    int64_t elapsed1 = absolute_time_diff_us(last_led1_update, now);

    // Primary LED (GPIO 2)
    uint32_t blink_interval = 500000;  // Default slow blink

    if (system_mode == MODE_TEST_PATTERN) {
        blink_interval = 500000;  // Slow blink (500ms)
    } else {
        // Check recent serial activity
        int64_t since_serial = absolute_time_diff_us(last_serial_data_time, now);
        if (since_serial < 1000000) {  // Active in last second
            blink_interval = 100000;  // Fast blink (100ms)
        }
    }

    if (elapsed0 >= blink_interval) {
        led0_state = !led0_state;
        gpio_put(GPIO_LED0, led0_state);
        last_led0_update = now;
    }

    // Secondary LED (GPIO 3) - Fault indicator
    if (fault_present) {
        // Blink if fault present
        if (elapsed1 >= 250000) {  // 250ms blink
            led1_state = !led1_state;
            gpio_put(GPIO_LED1, led1_state);
            last_led1_update = now;
        }
    } else if (fault_history) {
        // Brief flash once per second if fault history
        uint64_t now_us = to_us_since_boot(now);
        uint32_t phase = now_us % 1000000;  // Position within current second (0-999999 us)
        gpio_put(GPIO_LED1, phase < 50000);  // On for first 50ms of each second
    } else {
        gpio_put(GPIO_LED1, 0);  // Off
    }
}

// ============================================================================
// Button Handling
// ============================================================================

static void check_buttons(void) {
    static bool button0_last = false;
    static bool button1_last = false;

    // Button 0 - Reset (hardware debounced)
    bool button0_state = !gpio_get(GPIO_BUTTON0);  // Active low
    if (button0_state && !button0_last) {
        printf("Button 0: Reset requested\n");
        watchdog_reboot(0, 0, 0);
    }
    button0_last = button0_state;

    // Button 1 - Cycle test patterns (hardware debounced)
    bool button1_state = !gpio_get(GPIO_BUTTON1);  // Active low
    if (button1_state && !button1_last) {
        // Cycle to next pattern
        uint8_t next_pattern = (system_mode == MODE_TEST_PATTERN)
                               ? (current_test_pattern + 1) % NUM_TEST_PATTERNS
                               : 0;
        activate_test_pattern(next_pattern);
        printf("Button 1: Cycling to test pattern %d\n", next_pattern);
    }
    button1_last = button1_state;
}

// ============================================================================
// Timeout Detection
// ============================================================================

static void check_timeout(void) {
    if (system_mode == MODE_NORMAL) {
        int64_t since_serial = absolute_time_diff_us(last_serial_data_time, get_absolute_time());
        if (since_serial > TEST_PATTERN_TIMEOUT_MS * 1000) {
            printf("Timeout: Activating test pattern 0\n");
            activate_test_pattern(0);
        }
    }
}

// ============================================================================
// Initialization
// ============================================================================

static void init_sensors(void) {
    // Initialize ADC
    adc_init();
    adc_gpio_init(ADC_NTC0);
    adc_gpio_init(ADC_NTC1);
    adc_gpio_init(ADC_FB_M);

    // Initialize multiplexer control
    gpio_init(GPIO_FB_S0);
    gpio_init(GPIO_FB_S1);
    gpio_init(GPIO_FB_S2);
    gpio_set_dir(GPIO_FB_S0, GPIO_OUT);
    gpio_set_dir(GPIO_FB_S1, GPIO_OUT);
    gpio_set_dir(GPIO_FB_S2, GPIO_OUT);

    // Initialize I2C
    i2c_init(I2C_PORT, I2C_FREQ);
    gpio_set_function(I2C_SDA, GPIO_FUNC_I2C);
    gpio_set_function(I2C_SCL, GPIO_FUNC_I2C);
    gpio_pull_up(I2C_SDA);
    gpio_pull_up(I2C_SCL);

    // Initialize INA226
    sensors.ina226_present = ina226_init();
}

static void init_leds(void) {
    gpio_init(GPIO_LED0);
    gpio_init(GPIO_LED1);
    gpio_set_dir(GPIO_LED0, GPIO_OUT);
    gpio_set_dir(GPIO_LED1, GPIO_OUT);
    gpio_put(GPIO_LED0, 0);
    gpio_put(GPIO_LED1, 0);
}

static void init_buttons(void) {
    gpio_init(GPIO_BUTTON0);
    gpio_init(GPIO_BUTTON1);
    gpio_set_dir(GPIO_BUTTON0, GPIO_IN);
    gpio_set_dir(GPIO_BUTTON1, GPIO_IN);
    gpio_pull_up(GPIO_BUTTON0);
    gpio_pull_up(GPIO_BUTTON1);
}

// ============================================================================
// Main
// ============================================================================

int main() {
    // Initialize stdio (USB serial)
    stdio_init_all();
    sleep_ms(2000);

    boot_time = get_absolute_time();
    last_serial_data_time = boot_time;

    printf("\n=== WS2812 Proxy (Refactored) ===\n");
    printf("Version: 2.0\n");
    printf("Features: Gamma, Current Limiting, Test Patterns, Sensors, Status LEDs, Buttons\n");
    printf("Channels: %d (GPIO %d-%d)\n", NUM_CHANNELS, WS2812_PIN_BASE, WS2812_PIN_BASE + NUM_CHANNELS - 1);
    printf("Max LEDs/channel: %d\n", MAX_LEDS_PER_CHANNEL);

    // Initialize gamma correction
    printf("Gamma correction: ");
#if GAMMA_CORRECTION_ENABLE
    printf("ENABLED (gamma=%.2f)\n", GAMMA_VALUE);
#else
    printf("DISABLED\n");
#endif
    calc_gamma_table(GAMMA_VALUE);

    // Initialize sine table for test patterns
    printf("Initializing test pattern sine table...\n");
    init_sine_table();

    // Initialize current limiting
    printf("Current limiting: ");
#if CURRENT_LIMIT_ENABLE
    printf("ENABLED (threshold=%d)\n", CURRENT_LIMIT_THRESHOLD);
#else
    printf("DISABLED\n");
#endif

    // Initialize WS2812 channels
    printf("Initializing WS2812 channels...\n");
    for (uint8_t i = 0; i < NUM_CHANNELS; i++) {
        ws2812_channel_init(i);
        printf("  Channel %d: GPIO %d (PIO%d, SM%d)\n",
               i, channels[i].pin, pio_get_index(channels[i].pio), channels[i].sm);
    }

    // Initialize sensors
    printf("Initializing sensors...\n");
    init_sensors();
    printf("  INA226: %s\n", sensors.ina226_present ? "OK" : "NOT FOUND");

    // Initialize LEDs and buttons
    init_leds();
    init_buttons();

    printf("\n=== Ready ===\n");
    printf("Commands: 0xFF=Update+Flush, 0xFE=Update, 0xFD=Flush, 0xFC=Reset, 0xFB=Pattern, 0xFA=Stop, 0xF9=ClearAll\n");
    printf("Main loop: runs as fast as possible (sensors: %d Hz, patterns: %d Hz)\n\n",
           SENSOR_UPDATE_RATE_HZ, PATTERN_UPDATE_RATE_HZ);

    // Main loop runs as fast as possible
    // Individual functions handle their own timing requirements
    while (true) {
        // Execute main loop tasks
        parse_uart_data();

        // DMA handles LED updates in background - no blocking needed
        update_test_pattern();
        check_timeout();
        update_sensors();
        print_status_report();
        update_status_leds();
        check_buttons();

        tight_loop_contents();
    }

    return 0;
}
