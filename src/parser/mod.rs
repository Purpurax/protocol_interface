use crate::{core::Protocol, parser::{lexer::{Token, tokenize}, parser::parse_token_into_expression}};

pub mod lexer;
pub mod parser;


/// Parse a protocol file (.wet format) and return structured data
pub fn parse_protocol(content: &str) -> Result<Protocol, String> {
    println!("{}", content);

    let token_vec = tokenize(content).collect::<Vec<Token>>();
    
    let mut pos = 0;
    for token in token_vec.clone().into_iter() {
        let token_str = &content[pos..pos + token.len];
        pos += token.len;
        println!("Token: {:?}, value \"{}\"", token.kind, token_str);
    }

    let expression_vec = match parse_token_into_expression(content, token_vec) {
        Ok(val) => val,
        Err(err) => return Err(err)
    };

    println!("{:?}", expression_vec);
    
    // Ok(Protocol {
    //     name: "parsed_protocol".to_string(),
    //     steps: vec![],
    //     materials: HashMap::new(),
    // })
    Err(String::new())
}

