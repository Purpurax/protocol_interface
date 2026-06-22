// use crate::core::{material::Material, units::physical::{CentrifugalForce, Duration, Temperature}};

// pub fn centrifuge(material: Material, force: CentrifugalForce, duration: Duration) -> Vec<Material> {
//     // Compute what happens to organells etc inside the material

//     vec![material]
// }

// pub fn adjust_temperature(material: Material, temp: Temperature, dur: Duration) -> Material {
//     // Compute what happens to each material

//     Material {
//         id: material.id,
//         solution: if material.solution.
//     }
// }

// pub fn autoclave(material: &mut Material, duration: Duration) {
//     material.solution.is_sterile = true;
//     let (solution, proteins) = material.organisms.clone().into_iter()
//         .map(|organism| organism.autoclave_destruction())
//         .chain([(material.solution.clone(), material.proteins.clone())].into_iter())
//         .reduce(|(acc_solution, acc_protein), (e_sol, e_protein)| {
//             (acc_solution + e_sol, acc_protein + e_protein)
//         }).unwrap();
//     material.proteins = proteins;
//     material.solution = solution;
//     adjust_temperature(material, , duration)
// }
