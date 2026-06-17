use std::marker::PhantomData;
use crate::core::units::physical::Temperature;

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default, Hash)]
pub struct HazardClass {
    pub flammable: bool,
    pub corrosive: bool,
    pub toxic: bool,
    pub environmental: bool,
    pub oxidizer: bool
}

pub struct Solid;
pub struct Liquid;
pub struct Gas;

pub trait Phase {}
impl Phase for Solid {}
impl Phase for Liquid {}
impl Phase for Gas {}

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct PhaseTransitions {
    pub melting_point: Option<Temperature>,
    pub boiling_point: Option<Temperature>,
    pub glass_transition: Option<Temperature>, // Polymers
}
pub type MolecularFormula = String;

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in gram per liter
pub struct Concentration(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
pub struct Mol(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in gram per mol
pub struct Molar(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always with 0 = 0, 1 = 1/12 mass of unbounded neutral carbon-12 atom
pub struct Dalton(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in pH
pub struct Acidity(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
pub struct Amount<P: Phase> {
    pub value: f64,
    pub(super) _phase: PhantomData<P>
}
