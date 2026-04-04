use core::ops::{Add, Sub, Mul};
use libm::{sinf, cosf, floorf};
use smart_leds::RGB8;

#[derive(Clone)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Add for Vec3 {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self {
            x: self.x + other.x,
            y: self.y + other.y,
            z: self.z + other.z,
        }
    }
}

impl Add<f32> for Vec3 {
    type Output = Self;

    fn add(self, rhs: f32) -> Self {
        Self {
            x: self.x + rhs,
            y: self.y + rhs,
            z: self.z + rhs,
        }
    }
}

impl Sub for Vec3 {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Self {
            x: self.x - other.x,
            y: self.y - other.y,
            z: self.z - other.z,
        }
    }
}

impl Sub<f32> for Vec3 {
    type Output = Self;

    fn sub(self, rhs: f32) -> Self {
        Self {
            x: self.x - rhs,
            y: self.y - rhs,
            z: self.z - rhs,
        }
    }
}

impl Mul<f32> for Vec3 {
    type Output = Self;

    fn mul(self, rhs: f32) -> Self::Output {
        Self {
            x: self.x * rhs,
            y: self.y * rhs,
            z: self.z * rhs,
        }
    }
}

impl Vec3 {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn zero() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }

    pub fn rotate_x(self, r: f32) -> Self {
        Self {
            x: self.x,
            y: self.y * cosf(r) - self.z * sinf(r),
            z: self.y * sinf(r) + self.z * cosf(r),
        }
    }

    pub fn rotate_y(self, r: f32) -> Self {
        Self {
            x: self.x * cosf(r) - self.z * sinf(r),
            y: self.y,
            z: self.x * sinf(r) + self.z * cosf(r),
        }
    }

    pub fn rotate_z(self, r: f32) -> Self {
        Self {
            x: self.x * cosf(r) - self.y * sinf(r),
            y: self.x * sinf(r) + self.y * cosf(r),
            z: self.z,
        }
    }

    pub fn hsv_to_rgb(self) -> Vec3 {
        let (h, s, v) = (self.x, self.y, self.z);
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

    pub fn to_rgb8(self) -> RGB8 {
        RGB8::new(
            ((255.0 * self.x) as u8).clamp(0, 0xff),
            ((255.0 * self.y) as u8).clamp(0, 0xff),
            ((255.0 * self.z) as u8).clamp(0, 0xff),
        )
    }
}
