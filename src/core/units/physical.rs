
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in milli gram
pub struct Mass(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in Volume in micro liter
pub struct Volume(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in gram per milli liter
pub struct Density(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in Celsius
pub struct Temperature(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in milli seconds
pub struct Duration(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in relative centrifugal force x g
pub struct CentrifugalForce(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
pub struct OpticalDensity {
    pub wavelength: f64,
    pub unit: f64
}
