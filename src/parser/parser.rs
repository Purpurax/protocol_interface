use std::collections::HashMap;

use crate::{core::{Instruction, units::physical::{Duration, Mass, Temperature, Volume}}, parser::lexer::{LiteralKind, Token, TokenKind}};


#[derive(Debug)]
struct VersionValue {
    high: u8,
    medium: u8,
    low: u8
}

#[derive(Debug)]
enum FileInfoKind {
    Author(String),
    Version(VersionValue),
    Temperature(Temperature),
    Humidity(f64),
}

#[derive(Debug)]
enum Variable {
    Container(u64),
    Material(u64)
}

#[derive(Debug)]
pub enum Expression {
    FileInformation(FileInfoKind),
    Definition {
        alias: String,
        variable: Variable
    },
    Instruction(Instruction),
    Repeat {
        number_of_times: u8,
        exprs: Vec<Expression>
    }
}

fn author<'a>(input: &'a str, tokens: &Vec<Token>, pos: &mut usize, index: &mut usize) -> Result<Expression, String> {
    let mut token = &tokens[*index];
    *pos += token.len;
    if matches!(&token.kind, TokenKind::Whitespaces) {
        *index += 1;
        token = &tokens[*index];
        *pos += token.len;
    }

    let mut author = String::new();
    while matches!(&token.kind, TokenKind::Whitespaces | TokenKind::Literal(LiteralKind::Str)) {
        *index += 1;
        token = &tokens[*index];
        let token_str = &input[*pos..*pos + token.len];
        *pos += token.len;
        author.push_str(token_str);
    }

    while !matches!(&token.kind, TokenKind::NewLine | TokenKind::Eof) {
        if !matches!(&token.kind, TokenKind::NewLine | TokenKind::Eof | TokenKind::LineComment | TokenKind::BlockComment | TokenKind::Whitespaces) {
            return Err(String::from("Author failed after"))
        }

        token = &tokens[*index];
        *pos += token.len;
        *index += 1;
    }
    *index += 1;
    Ok(Expression::FileInformation(FileInfoKind::Author(author)))
}

fn version<'a>(input: &'a str, tokens: &Vec<Token>, pos: &mut usize, index: &mut usize) -> Result<Expression, String> {
    let mut token = &tokens[*index];
    let token_str = &input[*pos..*pos + token.len];
    *pos += token.len;
    if matches!(&token.kind, TokenKind::Whitespaces) {
        *index += 1;
        token = &tokens[*index];
        *pos += token.len;
    }
    
    if !matches!(&token.kind, TokenKind::Literal(LiteralKind::Version)) {
        return Err(String::from("Version has no version number"))
    }
    
    println!("{token_str}");
    let version_splitted: Vec<&str> = token_str.split('.').collect();
    if version_splitted.len() != 3 {
        return Err(String::from("Version number is invalid"))
    }
    
    let high = version_splitted[0]
        .parse::<u8>()
        .map_err(|_| String::from("Failed to parse version number"))?;
    let medium = version_splitted[1]
        .parse::<u8>()
        .map_err(|_| String::from("Failed to parse version number"))?;
    let low = version_splitted[2]
        .parse::<u8>()
        .map_err(|_| String::from("Failed to parse version number"))?;
    
    let version_value = VersionValue { high, medium, low };

    *index += 1;
    token = &tokens[*index];
    while !matches!(&token.kind, TokenKind::NewLine | TokenKind::Eof) {
        if !matches!(&token.kind, TokenKind::NewLine | TokenKind::Eof | TokenKind::LineComment | TokenKind::BlockComment | TokenKind::Whitespaces) {
            return Err(String::from("Version failed after"))
        }

        *index += 1;
        token = &tokens[*index];
        *pos += token.len;
    }
    *index += 1;
    Ok(Expression::FileInformation(FileInfoKind::Version(version_value)))
}

pub fn parse_token_into_expression<'a>(input: &'a str, tokens: Vec<Token>) -> Result<Vec<Expression>, String> {
    let mut result = vec![];

    let mut pos = 0;
    let mut index = 0;
    while index < tokens.len() {
        let mut token = &tokens[index];
        let token_str = &input[pos..pos + token.len];
        pos += token.len;
        index += 1;

        match &token.kind {
            TokenKind::LineComment
            | TokenKind::BlockComment
            | TokenKind::Whitespaces
            | TokenKind::NewLine
            | TokenKind::Eof => (),
            TokenKind::Unknown => println!("Unknown token: \"{}\"", token_str),
            TokenKind::Literal(literal_kind) => {
                if !matches!(literal_kind, LiteralKind::Str) {
                    return Err(String::from("Must start instruction with string literal"))
                }

                match token_str.to_ascii_lowercase().as_str() {
                    "author" => {
                        match author(input, &tokens, &mut pos, &mut index) {
                            Ok(value) => result.push(value),
                            Err(err) => return Err(err)
                        };
                    },
                    "version" => {
                        match version(input, &tokens, &mut pos, &mut index) {
                            Ok(value) => result.push(value),
                            Err(err) => return Err(err)
                        };
                    },
                    _ => ()
                }
            },
            TokenKind::Question => {
                token = &tokens[index];
                pos += token.len;
                index += 1;
                while token.kind != TokenKind::NewLine {
                    token = &tokens[index];
                    pos += token.len;
                    index += 1;
                }
                result.push(Expression::Instruction(Instruction::Unknown))
            },
            TokenKind::At
            | TokenKind::Pound
            | TokenKind::Tilde
            | TokenKind::Eq
            | TokenKind::Lt
            | TokenKind::Gt
            | TokenKind::And
            | TokenKind::Or => {
                return Err(String::from("Invalid start of Expression"))
            },
        }
    }
    Ok(result)
}
