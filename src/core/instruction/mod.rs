// use std::iter;

// use crate::core::{material::{Material, chemical::Solution}, units::{CentrifugalForce, Duration, Temperature}};

// pub fn centrifuge(material: Material, force: CentrifugalForce, duration: Duration) -> Vec<Material> {
//     // Compute what happens to organells etc inside the material

//     vec![material]
// }

// pub fn heat_to(material: Material, temp: Temperature, dur: Duration) -> Material {
//     // Compute what happens to each material

//     Material {
//         id: material.id,
//         solution: if material.solution.
//     }
// }

// pub fn autoclave(material: &mut Material) {
//     material.solution.is_sterile = true;
//     let (solution, proteins) = material.organisms.into_iter()
//         .chain([(material.solution, material.proteins)].into_iter())
//         .map(|organism| organism.autoclave_destruction())
//         .reduce(|(acc_solution, acc_protein), (e_sol, e_protein)| {
//             (acc_solution + e_sol, acc_protein + e_protein)
//         }).unwrap();
// }
