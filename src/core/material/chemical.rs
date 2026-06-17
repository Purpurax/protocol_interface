use std::fmt;
use std::ops::{Add, Sub};

use crate::core::units::chemical::{HazardClass, Mol, Molar, MolecularFormula, PhaseTransitions};
use crate::core::units::physical::{Density, Mass, Volume};


#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct Substance {
    pub cas_number: Option<String>,
    pub name: String,
    pub formula: Option<MolecularFormula>,
    pub hazard: HazardClass,
    pub molar: Molar,
    pub phase_transitions: PhaseTransitions,
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct SolutionComponent {
    pub substance: Substance,
    pub mol: Mol,
}

#[derive(Debug, Clone)]
pub struct Solution {
    pub name: String,
    pub components: Vec<SolutionComponent>,
    pub mass: Mass,
    pub volume: Volume,
    pub density: Density, // At room temperature and room pressure
    pub is_sterile: bool,
}

/* --- From into --- */

/* --- Display --- */
impl fmt::Display for HazardClass {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let hazards: String = [
            (self.flammable, "flammable"),
            (self.corrosive, "corrosive"),
            (self.toxic, "toxic"),
            (self.environmental, "environmental"),
            (self.oxidizer, "oxidizer"),
        ].into_iter()
        .filter_map(|(flag, name)| if flag { Some(name) } else { None })
        .collect::<Vec<&str>>()
        .join(", ");

        if hazards.is_empty() {
            write!(f, "harmless")
        } else {
            write!(f, "{}", hazards)
        }
    }
}

/* --- Operations --- */
impl Add<Solution> for Solution {
    type Output = Solution;
    fn add(mut self, other: Solution) -> Solution {
        'outer: for other_component in other.components.into_iter() {
            for self_component in self.components.iter_mut() {
                if self_component.substance == other_component.substance {
                    self_component.mol += other_component.mol;
                    continue 'outer;
                }
            }
            self.components.push(other_component);
        }
        self.mass += other.mass;
        self.volume += other.volume; // Error can happen here
        self.density = self.mass / self.volume;
        self.is_sterile &= other.is_sterile;
        self
    }
}
impl Sub<Volume> for Solution {
    type Output = Option<Solution>;
    fn sub(mut self, other: Volume) -> Option<Solution> {
        let ratio: f64 = other / self.volume;
        if ratio >= 1.0 {
            return None
        }

        for component in self.components.iter_mut() {
            component.mol *= ratio;
        }
        self.volume -= other;
        self.mass = self.density * self.volume;

        Some(self)
    }
}

/* --- Traits --- */

