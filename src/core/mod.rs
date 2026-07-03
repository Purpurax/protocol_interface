use std::collections::HashMap;

use crate::core::units::{Unit, physical::{Duration, Mass, Temperature, Volume}};

pub mod instruction;
pub mod material;
pub mod parser;
pub mod units;

#[derive(Debug, Clone)]
pub enum Amount {
    Volume(Volume),
    Mass(Mass)
}

#[derive(Debug, Clone)]
pub enum Instruction {
    Mix {
        amount: Amount,
        material_id: u64,
        into_container_id: u64
    },
    Autoclave {
        container_id: u64,
        time: Duration
    },
    Transfer {
        amount: Amount,
        from_container_id: u64,
        into_container_id: u64
    },
    Fill {
        amount: Amount,
        from_container_id: u64,
        into_container_id: u64
    },
    TemperatureControl {
        container_id: u64,
        temperature: Temperature
    },
    Wait(Duration),
    Unknown
}

#[derive(Debug, Clone)]
pub struct Protocol {
    pub name: String,
    pub author: String,
    pub version: (u8, u8, u8),
    pub temperature: Temperature,
    pub humidity: f64,
    pub instructions: Vec<Instruction>,
    pub definitions_materials: HashMap<String, u64>,
    pub definitions_containers: HashMap<String, u64>,
    pub definitions_variables: HashMap<String, (u64, fn(f64) -> f64, Unit)>,
}

impl Protocol {
    pub fn empty() -> Protocol {
        Protocol {
            name: String::from("Nameless"),
            author: String::from("Unknown"),
            version: (0, 0, 0),
            temperature: Temperature(25.0),
            humidity: 0.5,
            instructions: vec![],
            definitions_materials: HashMap::new(),
            definitions_containers: HashMap::new(),
            definitions_variables: HashMap::new(),
        }
    }
}
