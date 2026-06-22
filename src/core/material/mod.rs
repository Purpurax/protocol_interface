use chemical::*;
use organism::*;
use protein::*;

pub mod chemical;
pub mod organism;
pub mod protein;

#[derive(Debug, Clone)]
pub struct Material {
    pub id: u64,
    pub solution: Solution,
    pub proteins: Proteins,
    pub organisms: Vec<Organism>
}
