use crate::core::{material::{chemical::Solution, protein::Protein}, units::{chemical::Acidity, physical::Temperature}};

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub enum GramStain {
    Positive,
    Negative
}

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct GeneticSequence(pub Vec<u8>); // encode efficiently

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct Genome {
    pub sequence: GeneticSequence
}

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct Plasmid {
    pub name: String,
    pub sequence: GeneticSequence,
}

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct BacteriaProperties {
    gram_stain: GramStain,
    growth_rate_by_temperature: Vec<(Temperature, f64)>,
    growth_rate_by_acidity: Acidity,
    genome: Option<Genome>,
    plasmids: Vec<Plasmid>,
}
#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct ArchaeaProperties {

}
#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct EukaryoteProperties {

}
#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct VirusProperties {

}


#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub enum OrganismProperties {
    Bacteria(BacteriaProperties),
    Archaea(ArchaeaProperties),
    Eukaryote(EukaryoteProperties),
    Virus(VirusProperties)
}

#[derive(Debug, Clone)]
pub struct Organism {
    pub ncbi_id: u64,
    pub scientific_name: String,
    pub alias: String,
    pub genus: String,
    pub species: String,
    pub strain: Option<String>,
    pub containing_solution: Solution,
    pub containing_proteins: Vec<Protein>,
    pub properties: OrganismProperties
}

impl Organism {
    pub fn autoclave_destruction(self) -> (Solution, Vec<Protein>) {
        (self.containing_solution, self.containing_proteins)
    }
}
