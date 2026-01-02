cmake_minimum_required(VERSION 3.13...3.27)

# Point to existing picotool submodule to avoid re-downloading
set(PICOTOOL_FETCH_FROM_GIT_PATH ${CMAKE_CURRENT_LIST_DIR})

# initialize pico-sdk from submodule
# note: this must happen before project()
include(pico-sdk/pico_sdk_init.cmake)

project(pico_fw)

# initialize the Raspberry Pi Pico SDK
pico_sdk_init()

# wsproxy - UART to WS2812 proxy
add_executable(wsproxy
    wsproxy.c
    )

# Generate PIO header from WS2812.pio
pico_generate_pio_header(wsproxy ${CMAKE_CURRENT_LIST_DIR}/WS2812.pio)

# pull in dependencies
target_link_libraries(wsproxy
    pico_stdlib
    hardware_pio
    hardware_dma
    hardware_uart
    hardware_irq
    hardware_adc
    hardware_i2c
    hardware_watchdog
)

# Increase USB CDC buffer sizes for higher throughput
# Default is 64 bytes, increase to 512 bytes for RX/TX FIFOs and endpoint buffers
target_compile_definitions(wsproxy PRIVATE
    #CFG_TUD_MAX_SPEED=1
    CFG_TUD_CDC_RX_BUFSIZE=512
    CFG_TUD_CDC_TX_BUFSIZE=512
    CFG_TUD_CDC_EP_BUFSIZE=512
)

# enable usb output for debug, enable uart for data reception
pico_enable_stdio_usb(wsproxy 1)
pico_enable_stdio_uart(wsproxy 0)

# if (PICO_CYW43_SUPPORTED)
#     target_link_libraries(wsproxy pico_cyw43_arch_none)
# endif()

# create map/bin/hex file etc.
pico_add_extra_outputs(wsproxy)
