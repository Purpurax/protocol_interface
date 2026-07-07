pub mod log;

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;

fn main() {
    // let args: Vec<String> = env::args().collect();
    
    // if let Some(pos) = args.iter().position(|arg| arg == "--parse") {
    //     if pos + 1 < args.len() {
    //         let file_path = &args[pos + 1];
            
    //         if Path::new(file_path).exists() {
    //             match fs::read_to_string(file_path) {
    //                 Ok(content) => {
    //                     match parse_protocol(&content, HashMap::new()) {
    //                         Ok(protocol) => {
    //                             println!("Successfully parsed protocol: {:?}", protocol);
    //                         }
    //                         Err(e) => {
    //                             eprintln!("Error parsing protocol: {}", e);
    //                         }
    //                     }
    //                 }
    //                 Err(e) => {
    //                     eprintln!("Error reading file '{}': {}", file_path, e);
    //                 }
    //             }
    //         } else {
    //             eprintln!("File not found: {}", file_path);
    //         }
    //     } else {
    //         eprintln!("--parse requires a file path argument");
    //     }
    // } else {
    //     println!("Hello, world!");
    // }
}
