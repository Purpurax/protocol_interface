#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// 0 is unclear, 1 is monomeric, 2 is dimeric ...
pub struct OligomericState(pub u8);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Always in CFU per ml
pub struct ColonyCount(pub f64);

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
/// Used to determine concentration
pub struct ExtinctionCoefficient280(pub f64);
