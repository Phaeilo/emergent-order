#![no_std]
#![no_main]

use embassy_executor::Spawner;
use embassy_time::{Timer};
use esp_backtrace as _;
use esp_hal::{clock::CpuClock, rmt::Rmt, time::Rate};
use esp_hal_smartled::{RmtSmartLeds, buffer_size, color_order, Ws2812Timing};
use smart_leds::{brightness, gamma, hsv::Hsv, colors::BLACK, hsv::hsv2rgb, RGB8, SmartLedsWriteAsync};
use esp_hal::timer::timg::TimerGroup;
use log::info;
use libm::{sinf, cosf, floorf};

// This creates a default app-descriptor required by the esp-idf bootloader.
// For more information see: <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/app_image_format.html#application-description>
esp_bootloader_esp_idf::esp_app_desc!();


#[derive(Clone)]
struct Vec3 {
    x: f32,
    y: f32,
    z: f32
}

impl Vec3 {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self {x, y, z}
    }

    pub fn sub(self, s: f32) -> Self {
        Self {x: self.x-s, y: self.y-s, z: self.z-s}
    }
    pub fn scl(self, s: f32) -> Self {
        Self {x: self.x*s, y: self.y*s, z: self.z*s}
    }

    pub fn rotate_x(self, r: f32) -> Self {
        Self {
            x: self.x, 
            y: self.y * cosf(r) - self.z * sinf(r),
            z: self.y * sinf(r) + self.z * cosf(r),
        }
    }

    pub fn rotate_z(self, r: f32) -> Self {
        Self {
            x: self.x * cosf(r) - self.y * sinf(r),
            y: self.x * sinf(r) + self.y * cosf(r),
            z: self.z,
        }
    }
    pub fn to_rgb8(self) -> RGB8 {
        RGB8::new(
            ((255.0 * self.x) as u8).clamp(0, 0xff),
            ((255.0 * self.y) as u8).clamp(0, 0xff),
            ((255.0 * self.z) as u8).clamp(0, 0xff),
        )
    }

}


// impl<f32> Sub for Vec3 {
//     fn sub(self, o: f32) -> Self {
//         Self { self.x - o, self.y - o, self.z - o }
//     }
// }



const NUM_LEDS: usize = 77;
const LED_POSITIONS: [Option<Vec3>; NUM_LEDS] = [None, None, None, None, Some(Vec3{x:0.701594, y:0.162842, z:0.00199}), Some(Vec3{x:0.573369, y:0.125924, z:-0.608135}), Some(Vec3{x:0.162958, y:0.095177, z:-0.931908}), Some(Vec3{x:-0.383797, y:-0.224107, z:-0.595791}), Some(Vec3{x:-0.735397, y:-0.394604, z:-0.226268}), Some(Vec3{x:-0.225841, y:0.066345, z:-0.032082}), Some(Vec3{x:0.279031, y:0.494067, z:0.201981}), Some(Vec3{x:0.607424, y:0.510916, z:0.297643}), Some(Vec3{x:0.585738, y:-0.154317, z:0.514955}), Some(Vec3{x:0.39736, y:-0.541651, z:0.314982}), Some(Vec3{x:0.095858, y:-0.671398, z:-0.29687}), Some(Vec3{x:-0.125699, y:-0.419957, z:-0.698208}), Some(Vec3{x:-0.429694, y:0.219521, z:-0.687035}), Some(Vec3{x:-0.402353, y:0.52043, z:-0.499234}), Some(Vec3{x:0.151748, y:0.24159, z:-0.144122}), Some(Vec3{x:0.681048, y:-0.046613, z:0.217843}), Some(Vec3{x:0.580419, y:0.112459, z:0.484014}), Some(Vec3{x:0.079127, y:0.605382, z:0.558403}), Some(Vec3{x:-0.119707, y:0.512799, z:0.350068}), Some(Vec3{x:-0.03269, y:0.02764, z:-0.156668}), Some(Vec3{x:0.084506, y:-0.463937, z:-0.63751}), Some(Vec3{x:0.559482, y:-0.335534, z:-0.625719}), Some(Vec3{x:0.619876, y:0.173384, z:-0.471609}), Some(Vec3{x:0.24139, y:0.708706, z:-0.234359}), Some(Vec3{x:-0.044126, y:0.789245, z:-0.039766}), Some(Vec3{x:-0.030918, y:0.086168, z:0.065242}), Some(Vec3{x:-0.077403, y:-0.61019, z:0.101955}), Some(Vec3{x:-0.122761, y:-0.635408, z:0.249096}), Some(Vec3{x:-0.495243, y:-0.163948, z:0.619135}), Some(Vec3{x:-0.576176, y:0.242332, z:0.738622}), Some(Vec3{x:-0.025048, y:0.105137, z:0.30093}), Some(Vec3{x:0.570385, y:0.011587, z:-0.076301}), Some(Vec3{x:0.718821, y:-0.074792, z:-0.307437}), Some(Vec3{x:0.237526, y:-0.570655, z:-0.168997}), Some(Vec3{x:-0.158358, y:-0.899747, z:0.033708}), Some(Vec3{x:-0.163057, y:-0.510215, z:0.63044}), Some(Vec3{x:-0.255891, y:-0.184918, z:0.600694}), Some(Vec3{x:-0.653463, y:0.059591, z:0.057356}), Some(Vec3{x:-0.911331, y:0.243537, z:-0.497664}), Some(Vec3{x:-0.464731, y:0.566163, z:-0.091658}), Some(Vec3{x:-0.051347, y:0.906021, z:0.375217}), Some(Vec3{x:0.13519, y:0.451167, z:0.506491}), Some(Vec3{x:0.099964, y:-0.247873, z:0.563549}), Some(Vec3{x:0.215486, y:-0.761613, z:0.516384}), Some(Vec3{x:0.17185, y:-0.289268, z:0.000643}), Some(Vec3{x:0.107561, y:0.201042, z:-0.522464}), Some(Vec3{x:-0.065706, y:0.492079, z:-0.820565}), Some(Vec3{x:-0.240893, y:0.491775, z:-0.122317}), Some(Vec3{x:-0.355955, y:0.55119, z:0.578799}), Some(Vec3{x:-0.401074, y:0.175255, z:0.478134}), Some(Vec3{x:-0.527113, y:-0.333237, z:0.008896}), Some(Vec3{x:-0.497761, y:-0.595474, z:-0.389565}), Some(Vec3{x:-0.0136, y:-0.13361, z:-0.14339}), Some(Vec3{x:0.474087, y:0.318862, z:0.071}), Some(Vec3{x:0.577424, y:0.416489, z:0.3739}), Some(Vec3{x:0.079592, y:0.053257, z:0.735356}), Some(Vec3{x:-0.329579, y:-0.31227, z:0.701372}), Some(Vec3{x:-0.429589, y:-0.613049, z:0.062031}), Some(Vec3{x:-0.318714, y:-0.782599, z:-0.487799}), Some(Vec3{x:-0.086761, y:-0.501268, z:-0.281413}), Some(Vec3{x:-0.153901, y:0.010246, z:0.192456}), Some(Vec3{x:-0.21744, y:0.542304, z:0.663644}), Some(Vec3{x:-0.201737, y:0.84501, z:0.164011}), Some(Vec3{x:0.067875, y:0.8589, z:-0.329112}), Some(Vec3{x:0.570886, y:0.375813, z:-0.239793}), Some(Vec3{x:0.882187, y:-0.081695, z:-0.130359}), Some(Vec3{x:0.431371, y:-0.516118, z:0.214747}), Some(Vec3{x:-0.059563, y:-0.745354, z:0.423425}), Some(Vec3{x:-0.6153, y:-0.309674, z:0.307401}), Some(Vec3{x:-0.920448, y:0.120961, z:0.133791}), Some(Vec3{x:-0.369985, y:-0.077161, z:-0.263142}), Some(Vec3{x:0.19249, y:-0.278078, z:-0.653043}), Some(Vec3{x:0.356528, y:-0.010983, z:-1.0})];


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


    let mut led = {
        let frequency = Rate::from_mhz(80);
        let rmt = Rmt::new(peripherals.RMT, frequency).expect("Failed to initialize RMT0").into_async();
        RmtSmartLeds::<{ buffer_size::<RGB8>(NUM_LEDS) }, _, RGB8, color_order::Grb, Ws2812Timing>::new(rmt.channel0, peripherals.GPIO20).unwrap()
    };
    // let level = 10;
    // let mut color = Hsv {
    //     hue: 0,
    //     sat: 255,
    //     val: 255,
    // };
    // let mut data = [BLACK; NUM_LEDS];
    // let mut hue = 0;

    spawner.must_spawn(background_print());

    info!("Entering main loop!");

    let mut colors = [BLACK; NUM_LEDS];

    let mut t = 0.0;
    loop {
        for i in 0..NUM_LEDS {
            colors[i] = match &LED_POSITIONS[i] {
                Some(p) => get_color(p.clone(), t, i).to_rgb8(),
                None => BLACK
            }
        }

        // color.hue = hue; 
        // for i in SKIP_LEDS..NUM_LEDS {
        //     data[i] = colors;
        //     // data[i] = hsv2rgb(color);
        // }
        // let res = led.write(brightness(gamma(data.iter().cloned()), level)).await;
        // TODO: gamma
        let res = led.write(colors).await;
        res.unwrap();
        Timer::after_millis(20).await;
        t += 0.020; // TODO: oh dear!
        // hue = (hue + 1) & 0xff;
    }

}


fn my_hsv_to_rgb(h: f32, s: f32, v: f32) -> Vec3 {
    let h_ = if h > 1.0 || h < 0.0 { h - floorf(h) } else { h };

    let c = v * s;
    let x = c * (1.0 - (((h_ * 6.0) % 2.0) - 1.0).abs());
    let m = v - c;

    let h6 = h_ * 6.0;

    let (r, g, b) = if h6 < 1.0 {
        (c, x, 0.0)
    } else if h6 < 2.0 {
        (x, c, 0.0)
    } else if h6 < 3.0 {
        (0.0, c, x)
    } else if h6 < 4.0 {
        (0.0, x, c)
    } else if h6 < 5.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };

    Vec3::new(r + m, g + m, b + m)
}

fn get_color(pos: Vec3, t: f32, led_id: usize) -> Vec3 {
    // Center coordinates to [-0.5, 0.5]
    let mut _pos = pos.sub(0.5);

    // Calculate rotation angles
    let rot_speed = Vec3::new(1.3, 0.0, -2.9);
    let rot = rot_speed.scl(t);

    // Apply rotation around X/Z
    _pos = _pos.rotate_x(rot.x);
    _pos = _pos.rotate_z(rot.z);

    // SDF plane
    let sdf_value = _pos.y;

    let edge_smoothness = 0.15;

    // Turn SDF into brightness
    let sdf_brightness = if sdf_value < -edge_smoothness {
        1.0
    } else if sdf_value > edge_smoothness {
        0.0
    } else {
        // Smoothstep
        let v = (sdf_value + edge_smoothness) / (edge_smoothness * 2.0);
        let smooth = v * v * (3.0 - 2.0 * v);
        1.0 - smooth
    };

    // Determine current color
    let hue_cycle_duration = 180.0;
    let hue = (t / hue_cycle_duration) % 1.0;
    let color = my_hsv_to_rgb(hue, 0.95, 1.0).scl(sdf_brightness);

    color
}



#[embassy_executor::task]
async fn background_print() {
    let mut x = 0;
    loop {
        info!("Hello from Rust {}!", x);
        x += 1;
        Timer::after_secs(1).await;
    }
}
