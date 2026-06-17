// use crate::core::material::{Material, chemical::{Solution, SolutionComponent}};


// pub fn e_coli_liquid_media_from_liquid_media(liquid_media: Material) {
//     let minimal_media: Material = Material {
//         id: 0,
//         solution: Solution {
//             name: "M9".to_string(),
//             components: vec![
//                 SolutionComponent {
                    
//                 }
//             ]
//         }
//     }
// }

// extern crate proc_macro;
// use proc_macro::TokenStream;

// #[proc_macro]
// pub fn protocol(item: TokenStream) -> TokenStream {
//     println!("{}", item);
//     "let x = 3".parse().unwrap()
// }
use std::collections::HashMap;

/// Parse a protocol file (.wet format) and return structured data
pub fn parse_protocol(_content: &str) -> Result<Protocol, String> {
    // TODO: Implement your .wet file parsing logic here
    // Basic structure for now - expand based on your .wet format
    println!("{}", _content);
    
    Ok(Protocol {
        name: "parsed_protocol".to_string(),
        steps: vec![],
        materials: HashMap::new(),
    })
}

#[derive(Debug, Clone)]
pub struct Protocol {
    pub name: String,
    pub steps: Vec<String>,
    pub materials: HashMap<String, String>,
}
