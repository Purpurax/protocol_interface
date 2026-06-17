use core::fmt;
use std::{marker::PhantomData, ops::{Add, AddAssign, Div, Mul, MulAssign, SubAssign}};
use crate::core::units::{biological::{ColonyCount, ExtinctionCoefficient280}, chemical::{Acidity, Amount, Concentration, Dalton, Liquid, Mol, Solid}, physical::{CentrifugalForce, Density, Duration, Mass, OpticalDensity, Temperature, Volume}};

pub mod chemical;
pub mod physical;
pub mod biological;


/* --- From into --- */
impl From<f64> for Mass {
    fn from(mg: f64) -> Self { Mass(mg) }
}
impl From<Mass> for f64 {
    fn from(m: Mass) -> Self { m.0 }
}
impl From<f64> for Volume {
    fn from(ul: f64) -> Self { Volume(ul) }
}
impl From<Volume> for f64 {
    fn from(v: Volume) -> f64 { v.0 }
}
impl From<Amount<Solid>> for Mass {
    fn from(amount: Amount<Solid>) -> Mass {
        amount.value.into()
    }
}
impl From<f64> for ExtinctionCoefficient280 {
    fn from(value: f64) -> Self {
        ExtinctionCoefficient280(value)
    }
}
impl From<f64> for Acidity {
    fn from(value: f64) -> Self {
        Acidity(value)
    }
}
impl From<Acidity> for f64 {
    fn from(value: Acidity) -> f64 {
        value.0
    }
}

/* --- Display --- */
impl fmt::Display for Concentration {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} g/L", self.0)
    }
}
impl fmt::Display for Mass {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} mg", self.0)
    }
}
impl fmt::Display for Volume {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} µL", self.0)
    }
}
impl fmt::Display for Temperature {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}°C", self.0)
    }
}
impl fmt::Display for Duration {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} ms", self.0)
    }
}
impl fmt::Display for CentrifugalForce {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} g", self.0)
    }
}
impl fmt::Display for ColonyCount {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} CFU/mL", self.0)
    }
}
impl fmt::Display for OpticalDensity {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "OD@{}nm: {}", self.wavelength, self.unit)
    }
}

/* --- Operations --- */
impl Add<Dalton> for Dalton {
    type Output = Dalton;
    fn add(self, rhs: Dalton) -> Dalton {
        Dalton(self.0 + rhs.0)
    }
}
impl Add<ExtinctionCoefficient280> for ExtinctionCoefficient280 {
    type Output = ExtinctionCoefficient280;
    fn add(self, rhs: ExtinctionCoefficient280) -> ExtinctionCoefficient280 {
        ExtinctionCoefficient280(self.0 + rhs.0)
    }
}
impl AddAssign for Mass {
    fn add_assign(&mut self, other: Mass) { self.0 += other.0 }
}
impl AddAssign for Volume {
    fn add_assign(&mut self, other: Volume) { self.0 += other.0 }
}
impl Div<Volume> for Volume {
    type Output = f64;
    fn div(self, other: Volume) -> f64 { self.0 / other.0 }
}
impl SubAssign<Volume> for Volume {
    fn sub_assign(&mut self, other: Volume) { self.0 -= other.0 }
}
impl Mul<Volume> for Density {
    type Output = Mass;
    fn mul(self, other: Volume) -> Mass { Mass(self.0 * other.0) }
}
impl AddAssign for Mol {
    fn add_assign(&mut self, other: Mol) { self.0 += other.0 }
}
impl MulAssign<f64> for Mol {
    fn mul_assign(&mut self, other: f64) {
        self.0 *= other;
    }
}
impl Div<Volume> for Mass {
    type Output = Density;
    fn div(self, volume: Volume) -> Density {
        Density(self.0 / volume.0)
    }
}
impl std::iter::Sum for Dalton {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(Dalton(0.0), |acc, item| acc + item)
    }
}
impl std::iter::Sum for ExtinctionCoefficient280 {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(ExtinctionCoefficient280(0.0), |acc, item| acc + item)
    }
}

/* --- Traits --- */
impl Duration {
    pub fn ms(&self) -> u64 {
        self.0
    }
    pub fn seconds(&self) -> f64 {
        self.0 as f64 / 1000.0
    }
    pub fn minutes(&self) -> f64 {
        self.0 as f64 / 60000.0
    }
    pub fn hours(&self) -> f64 {
        self.0 as f64 / 3600000.0
    }
    pub fn days(&self) -> f64 {
        self.0 as f64 / 86400000.0
    }
    
    pub fn from_seconds(s: u64) -> Duration {
        Duration(s * 1000)
    }
    
    pub fn from_minutes(m: u64) -> Duration {
        Duration(m * 60000)
    }
    
    pub fn from_hours(h: u64) -> Duration {
        Duration(h * 3600000)
    }
}

impl Amount<Liquid> {
    pub fn volume(v: Volume) -> Self {
        Self { value: v.into(), _phase: PhantomData }
    }
}
impl Amount<Solid> {
    pub fn mass(m: Mass) -> Self {
        Self { value: m.into(), _phase: PhantomData }
    }
}
