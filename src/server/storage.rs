use crate::core::material::Material;

#[derive(Debug, Clone)]
pub struct TransporterPetriDish {
    pub has_petri_dish: bool,
    pub petri_dish_open: bool,
    pub petri_dish_reversed: bool,
    pub is_sterile: bool,
    pub is_dirty: bool,
    pub medium: Material,
}

#[derive(Debug, Clone)]
pub struct Well {
    pub is_sterile: bool,
    pub is_dirty: bool,
    pub medium: Material
}
#[derive(Debug, Clone)]
pub struct TransporterWellPlate {
    pub has_well_plate: bool,
    pub well_plate_open: bool,
    pub wells: [Well; 96]
}

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub enum Transporter {
    TransporterPetriDish,
    TransporterWellPlate,
}

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct Cargo {
    pub cargo_id: u64,
    pub transporter: Transporter,
}
