use std::collections::HashMap;

use crate::core::units::physical::{Duration, Mass, Temperature, Volume};

pub mod instruction;
pub mod material;
pub mod units;

#[derive(Debug, Clone)]
enum Amount {
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
    pub materials: HashMap<String, String>,
    pub containers: HashMap<String, String>
}
