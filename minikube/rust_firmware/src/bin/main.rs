#![no_std]
#![no_main]

use embassy_executor::Spawner;
use embassy_time::{Timer};
use esp_backtrace as _;
use esp_hal::{clock::CpuClock, rmt::Rmt, time::Rate, time::Instant, time::Duration};
use esp_hal_smartled::{RmtSmartLeds, buffer_size, color_order, Ws2812Timing};
use smart_leds::{brightness, gamma, colors::BLACK, RGB8, SmartLedsWriteAsync};
use esp_hal::timer::timg::TimerGroup;
use log::{info};
use minikube::vec::{Vec3, fast_sin};

// This creates a default app-descriptor required by the esp-idf bootloader.
// For more information see: <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/app_image_format.html#application-description>
esp_bootloader_esp_idf::esp_app_desc!();



trait DurationFloats {
    fn as_secs_f32(&self) -> f32;
}

impl DurationFloats for Duration {
    fn as_secs_f32(&self) -> f32 {
        self.as_micros() as f32 / 1000000.0
    }
}

trait TimerFloats {
    fn after_secs_f32(secs: f32) -> Self;
}

impl TimerFloats for Timer {
    fn after_secs_f32(secs: f32) -> Self {
        Timer::after_micros((secs * 1000000.0) as u64)
    }
}



#[esp_rtos::main]
async fn main(spawner: Spawner) -> ! {
    // generator version: 1.2.0

    esp_println::logger::init_logger_from_env();

    let config = esp_hal::Config::default().with_cpu_clock(CpuClock::max());
    let peripherals = esp_hal::init(config);

    let timg0 = TimerGroup::new(peripherals.TIMG0);
    let sw_interrupt =
        esp_hal::interrupt::software::SoftwareInterruptControl::new(peripherals.SW_INTERRUPT);
    esp_rtos::start(timg0.timer0, sw_interrupt.software_interrupt0);


    const NUM_LEDS: usize = 128;
    const LED_OFFSET: usize = 4;
    let mut led_coords: [Option<Vec3>; NUM_LEDS] = [None; NUM_LEDS];

    let mut pos_max: Option<Vec3> = None;
    let mut pos_min: Option<Vec3> = None;

    let pos_txt = include_str!("../led_positions_3d.txt");
    for line in pos_txt.lines() {
        if line.starts_with("LED_") {
            let mut split = line.split_whitespace();
            let led = split.next().unwrap();
            let led = led.split_once("_").unwrap().1;
            let led = led.parse::<usize>().unwrap();
            let led = led + LED_OFFSET;
            let x = split.next().unwrap();
            let y = split.next().unwrap();
            let z = split.next().unwrap();
            let x = x.parse::<f32>().unwrap();
            let y = y.parse::<f32>().unwrap();
            let z = z.parse::<f32>().unwrap();
            let coord = Vec3::new(x, y, z);
            info!("LED id={} pos x={} y={} z={}", led, coord.x, coord.y, coord.z);
            led_coords[led] = Some(coord);

            pos_max = Some(match pos_max {
                None => coord,
                Some(v) => v.max(coord)
            });

            pos_min = Some(match pos_min {
                None => coord,
                Some(v) => v.min(coord)
            });
        }
    }

    let pos_max = pos_max.unwrap();
    let pos_min = pos_min.unwrap();
    let pos_range = pos_max - pos_min;

    for i in 0..NUM_LEDS {
        let p = led_coords[i];
        if p.is_none() {
            continue;
        }
        let mut p = p.unwrap();
        p.x = if pos_range.x > 0.0 { (p.x - pos_min.x) / pos_range.x } else { 0.5 };
        p.y = if pos_range.y > 0.0 { (p.y - pos_min.y) / pos_range.y } else { 0.5 };
        p.z = if pos_range.z > 0.0 { (p.z - pos_min.z) / pos_range.z } else { 0.5 };
        led_coords[i] = Some(p);
    }
        
        
    let mut led = {
        let frequency = Rate::from_mhz(80);
        let rmt = Rmt::new(peripherals.RMT, frequency).expect("Failed to initialize RMT0").into_async();
        RmtSmartLeds::<{ buffer_size::<RGB8>(NUM_LEDS) }, _, RGB8, color_order::Grb, Ws2812Timing>::new(rmt.channel0, peripherals.GPIO20).unwrap()
    };

    let t0 = Instant::now();

    spawner.must_spawn(background_print());

    info!("Entering main loop!");

    let mut colors = [BLACK; NUM_LEDS];
    let mut frame_counter = 0;

    loop {
        let t = t0.elapsed();

        for i in 0..NUM_LEDS {
            colors[i] = match &led_coords[i] {
                Some(p) => get_color_plane(p.clone(), t, i).to_rgb8(),
                None => BLACK
            }
        }
        let t1 = t0.elapsed();

        let res = led.write(gamma(colors.into_iter())).await;
        // let res = led.write(colors.into_iter()).await;
        res.unwrap();

        frame_counter += 1;

        // Wait until next frame
        let target_fps = 50;
        let target_frametime = 1.0 / target_fps as f32;
        let frame_took = (t0.elapsed() - t).as_secs_f32();
        let compute_took = (t1 - t).as_secs_f32();
        let send_took = (t0.elapsed() - t1).as_secs_f32();
        let spare_time = target_frametime - frame_took;
        // if frame_counter % 100 == 0 {
        //     info!("frame={} took={}ms compute_took={}ms send_took={}ms spare={}ms", frame_counter, frame_took*1000.0, compute_took*1000.0, send_took*1000.0, spare_time*1000.0);
        // }
        if spare_time > 0.0 {
            Timer::after_secs_f32(spare_time).await;
        }
    }

}

fn smooth_sdf(value: f32, smoothness: f32) -> f32 {
    if value < -smoothness {
        1.0
    } else if value > smoothness {
        0.0
    } else {
        // Smoothstep
        let edge0 = -smoothness;
        let edge1 = smoothness;
        let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
        let t = t * t * (3.0 - 2.0 * t);
        1.0 - t
    }
}


fn get_color_plane(pos: Vec3, t: Duration, _led_id: usize) -> Vec3 {
    // Center coordinates to [-0.5, 0.5]
    let mut pos = pos - 0.5;
    let opos = pos;

    // Calculate rotation angles
    let rot_speed = Vec3::new(0.7, 0.0, -1.9);
    let rot = rot_speed * t.as_secs_f32();

    // Apply rotation
    pos = pos.rotate_x(rot.x);
    // _pos = _pos.rotate_y(rot.y);
    pos = pos.rotate_z(rot.z);

    // SDF plane
    let sdf_value = pos.y;

    // Turn SDF into brightness
    let sdf_brightness = smooth_sdf(sdf_value, 0.15);

    // Determine current color
    let hue_cycle_duration = 180.0;
    let saturation = 0.95;
    let brightness = 0.75;
    let hue = t.as_secs_f32() / hue_cycle_duration;
    let hue = hue - (0.2 * opos.x); // multicolor
    let color = Vec3::new(hue, saturation, brightness).hsv_to_rgb();

    color * sdf_brightness
}

fn get_color_expanding(pos: Vec3, t: Duration, _led_id: usize) -> Vec3 {
    // Center coordinates to [-0.5, 0.5]
    let mut pos = pos - 0.5;

    let t_ = libm::fmodf(t.as_secs_f32(), 5.0) / 5.0;
    // SDF sphere
    let sphere_size = t_;
    let sdf_value = pos.len() - sphere_size * 1.2;

    // Turn SDF into brightness
    let b = (t_ - 0.2).max(0.0);
    let b = (b * b) * 6.5;
    let b = 1.0 - b;
    let sdf_brightness = smooth_sdf(sdf_value, 0.15) * b;

    // Determine current color
    let hue_cycle_duration = 10.0;
    let saturation = 0.95;
    let brightness = 0.35;
    //let hue = t.as_secs_f32() / hue_cycle_duration;
    let hue = t_ * 0.5;
    let color = Vec3::new(hue, saturation, brightness).hsv_to_rgb();

    color * sdf_brightness
}

fn get_color_wobble(pos: Vec3, t: Duration, _led_id: usize) -> Vec3 {
    // Center coordinates to [-0.5, 0.5]
    let pos = pos - 0.5;
    let opos = pos;

    // Wobble
    let wobble_speed = 1.6;
    let wobble_scale = 0.1;
    let anim_time = t.as_secs_f32() * wobble_speed;
    let pos = Vec3::new(
        pos.x + wobble_scale * (fast_sin(pos.x * 10.0 + anim_time * 2.0)
                              + fast_sin(pos.z *  7.3 + anim_time * 1.3)),
        pos.y + wobble_scale * (fast_sin(pos.y *  8.5 + anim_time * 1.7)
                              + fast_sin(pos.x *  6.1 + anim_time * 2.3)),
        pos.z + wobble_scale * (fast_sin(pos.x *  9.2 + anim_time * 1.5)
                              + fast_sin(pos.y *  5.7 + anim_time * 1.9)),
    );

    // Sphere SDF
    let radius = 0.38;
    let sdf_value = pos.len() - radius;
    let sdf_brightness = smooth_sdf(sdf_value, 0.15);

    // Determine current color
    let hue_cycle_duration = 180.0;
    let saturation = 0.95;
    let brightness = 0.4;
    let hue = t.as_secs_f32() / hue_cycle_duration;
    let hue = 0.0;
    let hue = hue - (0.2 * opos.x); // multicolor
    let color = Vec3::new(hue, saturation, brightness).hsv_to_rgb();

    color * sdf_brightness
}

fn get_color_slices(pos: Vec3, t: Duration, _led_id: usize) -> Vec3 {
    // Center coordinates to [-0.5, 0.5]
    let mut pos = pos - 0.5;

    // Calculate rotation angles
    let timescale = 5.0;
    let speed = 1.0;
    let sub_t = libm::fmodf(t.as_secs_f32(), timescale) / timescale;
    let offset = (sub_t * speed) - 0.5;
    let offset = offset * 1.45;

    let sub_i = ((t.as_secs_f32() / timescale) as usize) % 6;

    let h = ((t.as_secs_f32() / timescale) as usize);
    let h = h * 2654435761 + 1337;
    let h = ((h >> 16) ^ h) * 0x45d9f3b;
    let h = ((h >> 16) ^ h) * 0x45d9f3b;
    let h = (h >> 16) ^ h;

    // SDF slice
    let slice_width = 0.4;
    let axis = match sub_i {
        0 => pos.x,
        1 => pos.y,
        2 => pos.z,
        3 => -pos.x,
        4 => -pos.y,
        5 => -pos.z,
        _ => 0.0,
    };
    let sdf_value = (axis + offset).abs() - slice_width * 0.5;

    // Turn SDF into brightness
    let sdf_brightness = smooth_sdf(sdf_value, 0.1);

    // Determine current color
    let saturation = 0.66;
    let brightness = 0.66;
    // let hues: [f32; 3] = [0.0, 0.25, 0.7];
    // let hue = hues[sub_i];
    let hue = 1.0 / 6.0 * (h % 6) as f32;
    let color = Vec3::new(hue, saturation, brightness).hsv_to_rgb();

    color * sdf_brightness
}


fn get_color_fireworks(pos: Vec3, t: Duration, led_id: usize) -> Vec3 {
    // Center coordinates to [-0.5, 0.5]
    let pos = pos - 0.5;

    let lifetime = 2.5;
    let sub_t = libm::fmodf(t.as_secs_f32(), lifetime) / lifetime; // [0, 1]
    let firework_id = (t.as_secs_f32() / lifetime) as usize;

    // Hash firework_id for random center and color
    let h = firework_id.wrapping_mul(2654435761).wrapping_add(1337);
    let h = ((h >> 16) ^ h).wrapping_mul(0x45d9f3b);
    let h = ((h >> 16) ^ h).wrapping_mul(0x45d9f3b);
    let h = (h >> 16) ^ h;

    let center = Vec3::new(
        (h & 0xff) as f32 / 255.0 - 0.5,
        ((h >> 8) & 0xff) as f32 / 255.0 - 0.5,
        ((h >> 16) & 0xff) as f32 / 255.0 - 0.5,
    );
    let hue = ((h >> 24) & 0xff) as f32 / 255.0;

    // Sphere occupies [0, 0.9]; remap so fade completes by then
    let sphere_t = (sub_t / 0.7).min(1.0);
    let diff = pos - center;
    let dist = libm::sqrtf(diff.x * diff.x + diff.y * diff.y + diff.z * diff.z);
    let radius = sphere_t * 1.15;
    let sdf_value = dist - radius;
    let fade = 1.0 - sphere_t * sphere_t * sphere_t;
    let sdf_brightness = smooth_sdf(sdf_value, 0.05) * fade;
    let sphere = Vec3::new(hue, 0.85, 1.0).hsv_to_rgb() * sdf_brightness;

    // Sparkle occupies [0.8, 1.0]: bell curve
    let sparkle_t = ((sub_t - 0.6) / 0.4).clamp(0.0, 1.0);
    let ramp = (sparkle_t * 6.0).min(1.0); // reaches peak fast
    let sparkle_env = ramp * (1.0 - sparkle_t) * (1.0 - sparkle_t);
    // Per-LED random phase and frequency — flickers across all LEDs
    let lh = led_id.wrapping_mul(2654435761) ^ h;
    let lh = ((lh >> 16) ^ lh).wrapping_mul(0x45d9f3b);
    let lh = (lh >> 16) ^ lh;
    let phase = (lh & 0xff) as f32 / 255.0 * (2.0 * 3.14159265);
    let freq = 8.0 + ((lh >> 8) & 0xff) as f32 / 255.0 * 16.0; // 8–24 Hz per LED
    let flicker = libm::sinf(t.as_secs_f32() * freq + phase) * 0.5 + 0.5;
    let sparkle_color = Vec3::new(1.0, 1.0, 1.0) * (flicker * sparkle_env);

    sphere + sparkle_color
}

fn get_color_linear(pos: Vec3, t: Duration, led_id: usize) -> Vec3 {

    let h = led_id.wrapping_mul(2654435761).wrapping_add(1337);
    let h = ((h >> 16) ^ h).wrapping_mul(0x45d9f3b);
    let h = ((h >> 16) ^ h).wrapping_mul(0x45d9f3b);
    let h = (h >> 16) ^ h;

    let phase = (h & 0xff) as f32 / 255.0 * (2.0 * 3.14159265);
    let freq = ((h >> 8) & 0xff) as f32 / 255.0 * 8.0 + 1.0;

    //let phase = led_id as f32 * 1.0;
    let bri = fast_sin(t.as_secs_f32() * freq + phase) * 0.5 + 0.5;

    // Determine current color
    let hue_cycle_duration = 180.0;
    let saturation = 0.95;
    let brightness = 0.8;
    let hue = t.as_secs_f32() / hue_cycle_duration;
    let hue = hue - (0.2 * pos.x); // multicolor
    let color = Vec3::new(hue, saturation, brightness).hsv_to_rgb();

    color * bri * 0.15
}


#[embassy_executor::task]
async fn background_print() {
    let mut x = 0;
    loop {
        info!("Hello from Rust {}!", x);
        x += 1;
        Timer::after_millis(25_000).await;
    }
}
