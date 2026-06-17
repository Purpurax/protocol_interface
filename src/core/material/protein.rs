use crate::core::units::{biological::{ExtinctionCoefficient280, OligomericState}, chemical::{Acidity, Dalton}};


#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub enum AminoAcid {
    Unclear = 0,
    Alanine = 1,
    Arginine = 2,
    Asparagine = 3,
    AsparticAcid = 4,
    Cysteine = 5,
    GlutamicAcid = 6,
    Glutamine = 7,
    Glycine = 8,
    Histidine = 9,
    Isoleucine = 10,
    Leucine = 11,
    Lysine = 12,
    Methionine = 13,
    Phenylalanine = 14,
    Proline = 15,
    Serine = 16,
    Threonine = 17,
    Tryptophan = 18,
    Tyrosine = 19,
    Valine = 20
}
#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct AminoAcidSequence(Vec<AminoAcid>);

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct Properties {
    pub sequence: AminoAcidSequence,
    pub molecular_weight: Dalton,
    pub extinction_coefficient_280nm: ExtinctionCoefficient280,
    pub isoelectric_point: Acidity,
    pub oligomeric_state: OligomericState,
}

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct Protein {
    pub id: u64,
    pub amount: u64,
    pub amount_error: f64,
    pub name: String,
}

impl From<char> for AminoAcid {
    fn from(value: char) -> Self {
        match value.to_ascii_uppercase() {
            'A' => AminoAcid::Alanine,
            'R' => AminoAcid::Arginine,
            'N' => AminoAcid::Asparagine,
            'D' => AminoAcid::AsparticAcid,
            'C' => AminoAcid::Cysteine,
            'E' => AminoAcid::GlutamicAcid,
            'Q' => AminoAcid::Glutamine,
            'G' => AminoAcid::Glycine,
            'H' => AminoAcid::Histidine,
            'I' => AminoAcid::Isoleucine,
            'L' => AminoAcid::Leucine,
            'K' => AminoAcid::Lysine,
            'M' => AminoAcid::Methionine,
            'F' => AminoAcid::Phenylalanine,
            'P' => AminoAcid::Proline,
            'S' => AminoAcid::Serine,
            'T' => AminoAcid::Threonine,
            'W' => AminoAcid::Tryptophan,
            'Y' => AminoAcid::Tyrosine,
            'V' => AminoAcid::Valine,
            _ => AminoAcid::Unclear
        }
    }
}
impl From<AminoAcid> for char {
    fn from(value: AminoAcid) -> Self {
        match value {
            AminoAcid::Alanine => 'A',
            AminoAcid::Arginine => 'R',
            AminoAcid::Asparagine => 'N',
            AminoAcid::AsparticAcid => 'D',
            AminoAcid::Cysteine => 'C',
            AminoAcid::GlutamicAcid => 'E',
            AminoAcid::Glutamine => 'Q',
            AminoAcid::Glycine => 'G',
            AminoAcid::Histidine => 'H',
            AminoAcid::Isoleucine => 'I',
            AminoAcid::Leucine => 'L',
            AminoAcid::Lysine => 'K',
            AminoAcid::Methionine => 'M',
            AminoAcid::Phenylalanine => 'F',
            AminoAcid::Proline => 'P',
            AminoAcid::Serine => 'S',
            AminoAcid::Threonine => 'T',
            AminoAcid::Tryptophan => 'W',
            AminoAcid::Tyrosine => 'Y',
            AminoAcid::Valine => 'V',
            AminoAcid::Unclear => '?'
        }
    }
}
impl From<&str> for AminoAcidSequence {
    fn from(value: &str) -> Self {
        value.chars()
            .filter_map(|c| {
                let upper = c.to_ascii_uppercase();
                if upper.is_ascii_uppercase() {
                    Some(upper.into())
                } else {
                    None
                }
            })
            .collect::<Vec<AminoAcid>>()
            .into()
    }
}
impl From<String> for AminoAcidSequence {
    fn from(value: String) -> Self {
        AminoAcidSequence::from(value.as_str())
    }
}
impl From<Vec<AminoAcid>> for AminoAcidSequence {
    fn from(value: Vec<AminoAcid>) -> Self {
        AminoAcidSequence(value)
    }
}

impl AminoAcid {
    pub fn weight(self) -> Dalton {
        Dalton(
            match self.into() {
                'A' => 71.0779,   // Alanine
                'R' => 156.1857,  // Arginine
                'N' => 114.1026,  // Asparagine
                'D' => 115.0874,  // Aspartic acid
                'C' => 103.1429,  // Cysteine
                'E' => 129.1140,  // Glutamic acid
                'Q' => 128.1292,  // Glutamine
                'G' =>  57.0513,  // Glycine
                'H' => 137.1393,  // Histidine
                'I' => 113.1576,  // Isoleucine
                'L' => 113.1576,  // Leucine
                'K' => 128.1723,  // Lysine
                'M' => 131.1961,  // Methionine
                'F' => 147.1739,  // Phenylalanine
                'P' =>  97.1152,  // Proline
                'S' =>  87.0773,  // Serine
                'T' => 101.1039,  // Threonine
                'W' => 186.2099,  // Tryptophan
                'Y' => 163.1733,  // Tyrosine
                'V' =>  99.1311,  // Valine
                _ => 0.0 // Invalid one-letter-code
            }
        )
    }

    pub fn charge_at_acidity(self, acidity: Acidity) -> f64 {
        let (sign, pka) = match self {
            // Acidic
            AminoAcid::Arginine => (-1.0, 12.503),
            AminoAcid::GlutamicAcid => (-1.0, 4.412),
            AminoAcid::Cysteine => (-1.0, 7.555), // Highly variable in practice
            AminoAcid::Tyrosine => (-1.0, 10.273),
            // Basic
            AminoAcid::AsparticAcid => (1.0, 3.872), // Mostly basic, rarely titrated
            AminoAcid::Histidine => (1.0, 5.637),
            AminoAcid::Lysine => (1.0, 9.052),
            _ => (0.0, 0.0)
        };
        let acidity_value: f64 = acidity.into();
        sign / (1.0 + f64::powf(10.0, sign * (acidity_value - pka)))
    }
}

impl AminoAcidSequence {
    /// Use one-letter code: XAV...
    pub fn new(sequence: String) -> AminoAcidSequence {
        sequence.into()
    }
    pub fn into_iter(self) -> impl Iterator<Item=AminoAcid> {
        self.0.into_iter()
    }
    pub fn iter(&self) -> impl Iterator<Item=&AminoAcid> {
        self.0.iter()
    }

    /// Accuracy 
    pub fn weight(self) -> Dalton {
        self.into_iter()
            .map(|amino_acid| amino_acid.weight())
            .sum()
    }

    /// Accuracy 
    pub fn extinction_coefficient_280nm(self) -> ExtinctionCoefficient280 {
        self.into_iter()
            .map(|amino_acid| {
                match amino_acid {
                    AminoAcid::Tryptophan => 5500.0,
                    AminoAcid::Tyrosine => 1490.0,
                    AminoAcid::Cysteine => 125.0,
                    _ => 0.0
                }
            })
            .sum::<f64>()
            .into()
    }

    /// Summed base_charges (pH) + Summed acid_charges (pH)
    fn net_charge(&self, acidity: Acidity) -> f64 {
        self.iter()
            .map(|amino_acid| amino_acid.clone().charge_at_acidity(acidity))
            .sum()
    }

    /// Accuracy of ~0.69 pH according to IPC2 Kozlowski 2021
    /// Validate if it is correct tho
    pub fn isoelectric_point(self) -> Acidity {
        const N_TERMINUS_IPC: f64 = 9.094;
        const C_TERMINUS_IPC: f64 = 2.869;
        const NUM_ITERATIONS: usize = 400;
        const ERROR_ALLOWED: f64 = 0.0001;

        let mut low: f64 = 0.0;
        let mut high: f64 = 14.0;
        let mut previous_mid: f64 = 7.0;

        for _ in 0..NUM_ITERATIONS {
            let mid_ph = (low + high) / 2.0;
            if self.net_charge(mid_ph.into()) > 0.0 {
                high = mid_ph;
            } else {
                low = mid_ph;
            }
            if (mid_ph - previous_mid).abs() <= ERROR_ALLOWED {
                break;
            }
            previous_mid = mid_ph;
        }

        (-((low + high) / 2.0).log10()).into()
    }
}

impl Properties {
    pub fn new(sequence: AminoAcidSequence) -> Self {
        Properties {
            sequence: sequence.clone(),
            molecular_weight: sequence.clone().weight(),
            extinction_coefficient_280nm: sequence.clone().extinction_coefficient_280nm(),
            isoelectric_point: sequence.clone().isoelectric_point(),
            oligomeric_state: OligomericState(0)
        }
    }
}
