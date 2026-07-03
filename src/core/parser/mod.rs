use crate::{core::{Amount, Instruction, Protocol, units::{Unit, physical::{Duration, Mass, Temperature, Volume}}}, core::parser::{parser::{AstTreeNode, GrammarExpandableKind, GrammarNode, TerminalKind, parse_token_into_ast}, scanner::{LiteralKind, Token, UNIT_MAP, tokenize}}};

pub mod scanner;
pub mod parser;

use GrammarNode::Expandable as exp;
use GrammarNode::Terminal as ter;
use GrammarExpandableKind as expk;

fn find_node(ast: &Vec<AstTreeNode>, children: &Vec<usize>, node: GrammarNode) -> Result<AstTreeNode, String> {
    for child_idx in children.iter() {
        let child = ast.get(*child_idx).unwrap();
        if child.kind == node {
            return Ok(child.clone());
        }
    }
    Err(format!("Could not find node: {:?} in ast", node))
}

fn find_nth(ast: &Vec<AstTreeNode>, children: &Vec<usize>, node: GrammarNode, index: usize) -> Result<AstTreeNode, String> {
    children.iter()
        .filter_map(|i| ast.get(*i))
        .filter(|c| c.kind == node)
        .nth(index)
        .cloned()
        .ok_or_else(|| format!("Could not find occurrence {} of node: {:?} in ast", index, node))
}

fn find_path(ast: &Vec<AstTreeNode>, children: &Vec<usize>, path: &[GrammarNode]) -> Result<AstTreeNode, String> {
    let mut scope = children.clone();
    let mut found = None;
    for step in path {
        let node = find_node(ast, &scope, step.clone())?;
        scope = node.child_indices.clone();
        found = Some(node);
    }
    found.ok_or_else(|| String::from("Empty path"))
}

fn get_unit_conversion_fn(input: &str) -> Option<fn(f64) -> f64> {
    for (key, _kind, conversion_fn) in UNIT_MAP.iter() {
        if *input == **key {
            return Some(conversion_fn.clone());
        }
    }
    None
}

fn parse_str(ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<String, String> {
    let literal = if let Ok(n) = find_node(ast, children, ter(TerminalKind::Literal(LiteralKind::Str))) {
        n
    } else {
        let string_node = find_node(ast, children, exp(expk::String))?;
        find_node(ast, &string_node.child_indices, ter(TerminalKind::Literal(LiteralKind::Str)))?
    };
    Ok(literal.token_string.trim_matches('"').to_string())
}

fn parse_float(value_str: &str) -> Result<f64, String> {
    let source = value_str.trim();
    let is_percent = source.ends_with('%');
    let normalized = source.trim_end_matches('%').trim();
    let value = normalized.parse::<f64>().map_err(|e| e.to_string())?;
    Ok(if is_percent { value / 100.0 } else { value })
}

fn parse_value(ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<f64, String> {
    if let Ok(n) = find_path(ast, children, &[exp(expk::ValueSuffix), exp(expk::Number), ter(TerminalKind::Literal(LiteralKind::Int))]) {
        return parse_float(&n.token_string);
    }
    if let Ok(n) = find_path(ast, children, &[exp(expk::ValueSuffix), exp(expk::Number), ter(TerminalKind::Literal(LiteralKind::Float))]) {
        return parse_float(&n.token_string);
    }
    if let Ok(n) = find_path(ast, children, &[exp(expk::Number), ter(TerminalKind::Literal(LiteralKind::Int))]) {
        return parse_float(&n.token_string);
    }
    if let Ok(n) = find_path(ast, children, &[exp(expk::Number), ter(TerminalKind::Literal(LiteralKind::Float))]) {
        return parse_float(&n.token_string);
    }
    Err(String::from("Value is missing a number"))
}

fn parse_amount(ast: &Vec<AstTreeNode>, children: &Vec<usize>, kind: Unit) -> Result<f64, String> {
    let value = find_node(ast, children, exp(expk::Value))?;
    let number = parse_value(ast, &value.child_indices)?;
    let unit = find_path(ast, children, &[exp(expk::AmountSuffix), exp(expk::Unit), ter(TerminalKind::Unit(kind))])?;
    let scale = get_unit_conversion_fn(&unit.token_string).ok_or_else(|| format!("Unknown unit \"{}\"", unit.token_string))?;
    Ok(scale(number))
}

fn parse_expression_of(protocol: &Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>, kind: Unit) -> Result<f64, String> {
    if let Ok(expression_value) = find_node(ast, children, exp(expk::ExpressionValue)) {
        if let Ok(amount) = find_node(ast, &expression_value.child_indices, exp(expk::Amount)) {
            parse_amount(ast, &amount.child_indices, kind)
        } else if let Ok(variable) = find_node(ast, &expression_value.child_indices, exp(expk::Variable)) {
            let id = find_path(ast, &variable.child_indices, &[exp(expk::VariableId), ter(TerminalKind::Literal(LiteralKind::Int))])?;
            let value = id.token_string.parse::<f64>().map_err(|e| e.to_string())?; // TODO TEMPORARY FIX
            let unit = find_path(ast, &variable.child_indices, &[exp(expk::Unit), ter(TerminalKind::Unit(kind))])?;
            let scale = get_unit_conversion_fn(&unit.token_string).ok_or_else(|| format!("Unknown unit \"{}\"", unit.token_string))?;
            Ok(scale(value))
        } else if let Ok(ident) = find_node(ast, &expression_value.child_indices, exp(expk::Ident)) {
            let name = parse_str(ast, &ident.child_indices)?;
            if let Some((id, scale, unit_kind)) = protocol.definitions_variables.get(&name) {
                if kind == *unit_kind {
                    let value = *id as f64; // TODO TEMPORARY FIX
                    Ok(scale(value))
                } else {
                    Err(format!("Expected unit {:?}, but got unit {:?}", kind, unit_kind))
                }
            } else {
                Err(format!("Definition for containers does not contain the name {}", name))
            }
        } else {
            Err(String::from("No amount, variable or ident supplied for expression"))
        }
    } else if let Ok(expression_inner) = find_node(ast, children, exp(expk::ExpressionInner)) {
        let expression_inner_1 = find_nth(ast, &expression_inner.child_indices, exp(expk::Expression), 0)?;
        let expression_inner_2 = find_nth(ast, &expression_inner.child_indices, exp(expk::Expression), 1)?;
        let value_1 = parse_expression_of(protocol, ast, &expression_inner_1.child_indices, kind)?;
        let value_2 = parse_expression_of(protocol, ast, &expression_inner_2.child_indices, kind)?;

        let operator = find_node(ast, &expression_inner.child_indices, exp(expk::Operator))?;
        let operator_suffix = find_node(ast, &operator.child_indices, exp(expk::OperatorSuffix))?;
        if find_node(ast, &operator_suffix.child_indices, ter(TerminalKind::Minus)).is_ok() {
            Ok(value_1 - value_2)
        } else if find_node(ast, &operator_suffix.child_indices, ter(TerminalKind::Times)).is_ok() {
            Ok(value_1 * value_2)
        } else if find_node(ast, &operator_suffix.child_indices, ter(TerminalKind::Divided)).is_ok() {
            Ok(value_1 / value_2)
        } else {
            Ok(value_1 + value_2)
        }
    } else {
        Err(String::new())
    }
}

fn parse_amount_of(ast: &Vec<AstTreeNode>, children: &Vec<usize>, kind: Unit) -> Result<f64, String> {
    let amount = find_node(ast, children, exp(expk::Amount))?;
    parse_amount(ast, &amount.child_indices, kind)
}

fn parse_transfer_expression(protocol: &Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<Amount, String> {
    let expression = find_node(ast, children, exp(expk::Expression))?;
    if let Ok(v) = parse_expression_of(protocol, ast, &expression.child_indices, Unit::Volume) {
        return Ok(Amount::Volume(Volume(v)));
    }
    if let Ok(m) = parse_expression_of(protocol, ast, &expression.child_indices, Unit::Mass) {
        return Ok(Amount::Mass(Mass(m)));
    }
    Err(String::from("Transfer amount must have a volume or mass unit"))
}

fn parse_container_ref(protocol: &Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<u64, String> {
    if let Ok(container) = find_node(ast, children, exp(expk::Container)) {
        let id = find_path(ast, &container.child_indices, &[exp(expk::ContainerId), ter(TerminalKind::Literal(LiteralKind::Int))])?;
        id.token_string.parse::<u64>().map_err(|e| e.to_string())
    } else if let Ok(ident) = find_node(ast, &children, exp(expk::Ident)) {
        let name = parse_str(ast, &ident.child_indices)?;
        if let Some(id) = protocol.definitions_containers.get(&name) {
            Ok(*id)
        } else {
            Err(format!("Definition for containers does not contain the name {}", name))
        }
    } else {
        Err(String::from("Invalid Syntax - expecting container"))
    }
}

fn parse_material_ref(protocol: &Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<u64, String> {
    if let Ok(container) = find_node(ast, children, exp(expk::Container)) {
        let id = find_path(ast, &container.child_indices, &[exp(expk::ContainerId), ter(TerminalKind::Literal(LiteralKind::Int))])?;
        id.token_string.parse::<u64>().map_err(|e| e.to_string())
    } else if let Ok(ident) = find_node(ast, &children, exp(expk::Ident)) {
        let name = parse_str(ast, &ident.child_indices)?;
        if let Some(id) = protocol.definitions_materials.get(&name) {
            Ok(*id)
        } else {
            Err(format!("Definition for material does not contain the name {}", name))
        }
    } else {
        Err(String::from("Invalid Syntax - expecting container"))
    }
}

fn parse_definition(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    let infix = find_node(ast, children, exp(expk::DefinitionInfix))?;
    let ident = find_node(ast, children, exp(expk::Ident))?;
    let name = parse_str(ast, &ident.child_indices)?;

    if let Ok(container) = find_node(ast, &infix.child_indices, exp(expk::Container)) {
        let id = find_path(ast, &container.child_indices, &[exp(expk::ContainerId), ter(TerminalKind::Literal(LiteralKind::Int))])?;
        protocol.definitions_containers.insert(name, id.token_string.parse::<u64>().map_err(|e| e.to_string())?);
        return Ok(());
    } else if let Ok(material) = find_node(ast, &infix.child_indices, exp(expk::Material)) {
        let id = find_path(ast, &material.child_indices, &[exp(expk::MaterialId), ter(TerminalKind::Literal(LiteralKind::Int))])?;
        protocol.definitions_materials.insert(name, id.token_string.parse::<u64>().map_err(|e| e.to_string())?);
        return Ok(());
    } else if let Ok(variable) = find_node(ast, &infix.child_indices, exp(expk::Variable)) {
        let id = find_path(ast, &variable.child_indices, &[exp(expk::VariableId), ter(TerminalKind::Literal(LiteralKind::Int))])?;
        let id_value = id.token_string.parse::<u64>().map_err(|e| e.to_string())?; // TODO TEMPORARY FIX
        let unit = find_node(ast, &variable.child_indices, exp(expk::Unit))?;
        let unit_terminal = ast.get(*unit.child_indices.first().unwrap()).unwrap();
        
        if let ter(TerminalKind::Unit(unit_kind)) = unit_terminal.kind {
            let scale = get_unit_conversion_fn(&unit_terminal.token_string).ok_or_else(|| format!("Unknown unit \"{}\"", unit_terminal.token_string))?;
            protocol.definitions_variables.insert(name, (id_value, scale, unit_kind));
            Ok(())
        } else {
            Err(String::from("Unable to parse definition because no unit was provided"))
        }
    } else {
        Err(String::from("Defining a name from an existing ident requires resolving the source ident, which is not supported during parsing"))
    }
}

fn parse_author(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    protocol.author = parse_str(ast, children)?;
    Ok(())
}

fn parse_version(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    let node = find_node(ast, children, ter(TerminalKind::Literal(LiteralKind::Version)))?;
    let parts = node.token_string.split('.').map(|p| p.parse::<u8>()).collect::<Result<Vec<u8>, _>>().map_err(|e| e.to_string())?;
    match parts.as_slice() {
        [major, minor, patch] => {
            protocol.version = (*major, *minor, *patch);
            Ok(())
        },
        _ => Err(format!("Version \"{}\" is not in major.minor.patch format", node.token_string))
    }
}

fn parse_name(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    protocol.name = parse_str(ast, children)?;
    Ok(())
}

fn parse_global_temperature(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    protocol.temperature = Temperature(parse_amount_of(ast, children, Unit::Temperature)?);
    Ok(())
}

fn parse_global_humidity(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    let value = find_node(ast, children, exp(expk::Value))?;
    protocol.humidity = parse_value(ast, &value.child_indices)?;
    Ok(())
}

fn parse_transfer(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    let amount = parse_transfer_expression(protocol, ast, children)?;
    let from = find_nth(ast, children, exp(expk::DefinitionInfix), 0)?;
    let into = find_nth(ast, children, exp(expk::DefinitionInfix), 1)?;
    let into_container_id = parse_container_ref(protocol, ast, &into.child_indices)?;
    if let Ok(from_container_id) = parse_container_ref(protocol, ast, &from.child_indices) {
        protocol.instructions.push(Instruction::Transfer { amount, from_container_id, into_container_id });
        Ok(())
    } else {
        let from_material_id = parse_material_ref(protocol, ast, &from.child_indices)?;
        protocol.instructions.push(Instruction::Transfer { amount, from_container_id: from_material_id, into_container_id });
        Ok(())
    }
}

fn parse_fill(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    let amount = parse_transfer_expression(protocol, ast, children)?;
    let into = find_nth(ast, children, exp(expk::DefinitionInfix), 0)?;
    let from = find_nth(ast, children, exp(expk::DefinitionInfix), 1)?;
    let into_container_id = parse_container_ref(protocol, ast, &into.child_indices)?;
    if let Ok(from_container_id) = parse_container_ref(protocol, ast, &from.child_indices) {
        protocol.instructions.push(Instruction::Fill { amount, from_container_id, into_container_id });
        Ok(())
    } else {
        let from_material_id = parse_material_ref(protocol, ast, &from.child_indices)?;
        protocol.instructions.push(Instruction::Fill { amount, from_container_id: from_material_id, into_container_id });
        Ok(())
    }
}

fn parse_temperature(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    let infix = find_node(ast, children, exp(expk::DefinitionInfix))?;
    let container_id = parse_container_ref(protocol, ast, &infix.child_indices)?;
    let expression = find_node(ast, children, exp(expk::Expression))?;
    let temperature = Temperature(parse_expression_of(protocol, ast, &expression.child_indices, Unit::Temperature)?);
    protocol.instructions.push(Instruction::TemperatureControl { container_id, temperature });
    Ok(())
}

fn parse_wait(protocol: &mut Protocol, ast: &Vec<AstTreeNode>, children: &Vec<usize>) -> Result<(), String> {
    let expression = find_node(ast, children, exp(expk::Expression))?;
    let seconds = parse_expression_of(protocol, ast, &expression.child_indices, Unit::Duration)?;
    protocol.instructions.push(Instruction::Wait(Duration(seconds.round() as u64)));
    Ok(())
}

fn parse_ast_to_protocol(ast: Vec<AstTreeNode>) -> Result<Protocol, String> {
    let mut protocol = Protocol::empty();
    for node in ast.clone().into_iter() {
        if let GrammarNode::Expandable(expandable) = node.kind {
            match expandable {
                GrammarExpandableKind::Definition => parse_definition(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::Author => parse_author(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::Version => parse_version(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::Name => parse_name(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::GlobalTemperature => parse_global_temperature(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::GlobalHumidity => parse_global_humidity(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::Transfer => parse_transfer(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::Fill => parse_fill(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::Temperature => parse_temperature(&mut protocol, &ast, &node.child_indices),
                GrammarExpandableKind::Wait => parse_wait(&mut protocol, &ast, &node.child_indices),
                _ => Ok(())
            }?;
        }
    }
    Ok(protocol)
}

/// Parse a protocol file (.wet format) and return structured data
pub fn parse_protocol(content: &str) -> Result<Protocol, String> {
    // println!("{}", content);

    let token_vec = match tokenize(content) {
        Ok(val) => val,
        Err(err) => return Err(err)  
    }.collect::<Vec<Token>>();

    // let mut pos = 0;
    // for token in token_vec.clone().into_iter() {
    //     let token_str = &content[pos..pos + token.len];
    //     pos += token.len;
    //     print!("\"{}\"-", token_str);
    // }
    // println!("");

    let ast = match parse_token_into_ast(content, token_vec.clone()) {
        Ok(val) => val,
        Err(err) => return Err(err)
    };

    // println!("{:?}", token_vec);

    // println!("{:?}", ast);

    let protocol = match parse_ast_to_protocol(ast) {
        Ok(val) => val,
        Err(err) => return Err(err)
    };
    
    // Ok(Protocol {
    //     name: "parsed_protocol".to_string(),
    //     steps: vec![],
    //     materials: HashMap::new(),
    // })
    Ok(protocol)
}
