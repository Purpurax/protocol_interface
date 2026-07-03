use std::collections::{HashMap, HashSet};

use crate::core::units::Unit;
use crate::parser::scanner::{KeywordKind, LiteralKind};
use crate::parser::scanner::{Token, TokenKind};

use GrammarExpandableKind as expk;
use GrammarNode::Expandable as exp;
use GrammarNode::Terminal as ter;
use TokenKind as t;

// CANNOT CONTAIN LOOPS
fn get_grammar() -> Vec<(expk, Vec<GrammarNode>)> {
    vec![
        (expk::Document, vec![ter(t::Eof)]),
        (expk::Document, vec![exp(expk::Lines), ter(t::Eof)]),
        (expk::Lines, vec![exp(expk::Line), exp(expk::Lines)]),
        (expk::Line, vec![exp(expk::LineSuffix)]),
        (expk::Line, vec![exp(expk::Element), exp(expk::LineSuffix)]),
        (expk::LineSuffix, vec![ter(t::NewLine)]),
        (expk::LineSuffix, vec![ter(t::Whitespaces), ter(t::NewLine)]),
        (expk::Element, vec![exp(expk::Definition)]),
        (expk::Element, vec![exp(expk::FileInfo)]),
        (expk::Element, vec![exp(expk::Instruction)]),

        (expk::Expression, vec![ter(t::LeftBracket), exp(expk::ExpressionInner), ter(t::RightBracket)]),
        (expk::Expression, vec![exp(expk::ExpressionValue)]),
        (expk::Expression, vec![ter(t::Whitespaces), exp(expk::ExpressionValue)]),
        (expk::ExpressionInner, vec![exp(expk::Expression), exp(expk::Operator), exp(expk::Expression)]),
        (expk::ExpressionValue, vec![exp(expk::Amount)]),
        (expk::ExpressionValue, vec![exp(expk::Variable)]),
        (expk::ExpressionValue, vec![exp(expk::Ident)]),
        (expk::Operator, vec![exp(expk::OperatorSuffix)]),
        (expk::Operator, vec![ter(t::Whitespaces), exp(expk::OperatorSuffix)]),
        (expk::OperatorSuffix, vec![ter(t::Plus)]),
        (expk::OperatorSuffix, vec![ter(t::Minus)]),
        (expk::OperatorSuffix, vec![ter(t::Times)]),
        (expk::OperatorSuffix, vec![ter(t::Divided)]),
        (expk::String, vec![ter(t::Literal(LiteralKind::Str))]),
        (expk::Unit, vec![ter(t::Unit(Unit::Temperature))]),
        (expk::Unit, vec![ter(t::Unit(Unit::Duration))]),
        (expk::Unit, vec![ter(t::Unit(Unit::Mass))]),
        (expk::Unit, vec![ter(t::Unit(Unit::Volume))]),
        (expk::Unit, vec![ter(t::Unit(Unit::OD))]),
        (expk::Unit, vec![ter(t::Unit(Unit::CentrifugalForce))]),
        (expk::Unit, vec![ter(t::Unit(Unit::Molar))]),
        (expk::Unit, vec![ter(t::Unit(Unit::ColonyCount))]),
        (expk::Number, vec![ter(t::Literal(LiteralKind::Int))]),
        (expk::Number, vec![ter(t::Literal(LiteralKind::Float))]),
        (expk::Value, vec![exp(expk::Number)]),
        (expk::Value, vec![exp(expk::Sign), exp(expk::ValueSuffix)]),
        (expk::ValueSuffix, vec![exp(expk::Number)]),
        (expk::ValueSuffix, vec![ter(t::Whitespaces), exp(expk::Number)]),
        (expk::Sign, vec![ter(t::Tilde)]),
        (expk::Sign, vec![ter(t::Lt)]),
        (expk::Sign, vec![ter(t::Le)]),
        (expk::Sign, vec![ter(t::Eq)]),
        (expk::Sign, vec![ter(t::Gt)]),
        (expk::Sign, vec![ter(t::Ge)]),
        (expk::Amount, vec![exp(expk::Value), exp(expk::AmountSuffix)]),
        (expk::AmountSuffix, vec![exp(expk::Unit)]),
        (expk::AmountSuffix, vec![ter(t::Whitespaces), exp(expk::Unit)]),
        (expk::Ident, vec![exp(expk::String)]),
        (expk::ContainerId, vec![ter(t::Literal(LiteralKind::Int))]),
        (expk::ContainerId, vec![ter(t::Whitespaces), ter(t::Literal(LiteralKind::Int))]),
        (expk::MaterialId, vec![ter(t::Literal(LiteralKind::Int))]),
        (expk::MaterialId, vec![ter(t::Whitespaces), ter(t::Literal(LiteralKind::Int))]),
        (expk::VariableId, vec![ter(t::Literal(LiteralKind::Int))]),
        (expk::VariableId, vec![ter(t::Whitespaces), ter(t::Literal(LiteralKind::Int))]),
        (expk::Container, vec![ter(t::Pound), exp(expk::ContainerId)]),
        (expk::Material, vec![ter(t::At), exp(expk::MaterialId)]),
        (expk::Variable, vec![ter(t::Dollar), exp(expk::VariableId), exp(expk::Unit)]),

        (expk::Definition, vec![ter(t::Keyword(KeywordKind::Define)), ter(t::Whitespaces), exp(expk::DefinitionInfix), ter(t::Whitespaces), ter(t::Keyword(KeywordKind::As)), ter(t::Whitespaces), exp(expk::Ident)]),
        (expk::DefinitionInfix, vec![exp(expk::Container)]),
        (expk::DefinitionInfix, vec![exp(expk::Material)]),
        (expk::DefinitionInfix, vec![exp(expk::Variable)]),
        (expk::DefinitionInfix, vec![exp(expk::Ident)]),

        (expk::FileInfo, vec![exp(expk::Author)]),
        (expk::FileInfo, vec![exp(expk::Version)]),
        (expk::FileInfo, vec![exp(expk::Name)]),
        (expk::FileInfo, vec![exp(expk::GlobalTemperature)]),
        (expk::FileInfo, vec![exp(expk::GlobalHumidity)]),

        (expk::Author, vec![ter(t::Keyword(KeywordKind::InfoAuthor)), ter(t::Whitespaces), exp(expk::String)]),
        (expk::Version, vec![ter(t::Keyword(KeywordKind::InfoVersion)), ter(t::Whitespaces), ter(t::Literal(LiteralKind::Version))]),
        (expk::Name, vec![ter(t::Keyword(KeywordKind::InfoName)), ter(t::Whitespaces), ter(t::Literal(LiteralKind::Str))]),
        (expk::GlobalTemperature, vec![ter(t::Keyword(KeywordKind::InfoTemperature)), ter(t::Whitespaces), exp(expk::Amount)]),
        (expk::GlobalHumidity, vec![ter(t::Keyword(KeywordKind::InfoHumidity)), ter(t::Whitespaces), exp(expk::Value)]),

        (expk::Instruction, vec![exp(expk::Transfer)]),
        (expk::Instruction, vec![exp(expk::Fill)]),
        // (expk::Operation, vec![exp(expk::Centrifuge)]),
        (expk::Instruction, vec![exp(expk::Temperature)]),
        (expk::Instruction, vec![exp(expk::Wait)]),
        (expk::Transfer, vec![ter(t::Keyword(KeywordKind::Transfer)), ter(t::Whitespaces), exp(expk::Expression), ter(t::Whitespaces), ter(t::Keyword(KeywordKind::Of)), ter(t::Whitespaces), exp(expk::DefinitionInfix), ter(t::Whitespaces), ter(t::Keyword(KeywordKind::Into)), ter(t::Whitespaces), exp(expk::DefinitionInfix)]),
        (expk::Fill, vec![ter(t::Keyword(KeywordKind::Fill)), ter(t::Whitespaces), exp(expk::DefinitionInfix), ter(t::Whitespaces), ter(t::Keyword(KeywordKind::To)), ter(t::Whitespaces), exp(expk::Expression), ter(t::Whitespaces), ter(t::Keyword(KeywordKind::Using)), ter(t::Whitespaces), exp(expk::DefinitionInfix)]),
        // (expk::Centrifuge, vec![exp(expk::String), ter(t::Whitespaces), ter(t::Keyword(KeywordKind::With)), ter(t::Whitespaces), exp(expk::Amount)]),
        (expk::Temperature, vec![ter(t::Keyword(KeywordKind::Temperature)), ter(t::Whitespaces), exp(expk::DefinitionInfix), ter(t::Whitespaces), ter(t::Keyword(KeywordKind::To)), ter(t::Whitespaces), exp(expk::Expression)]),
        (expk::Wait, vec![ter(t::Keyword(KeywordKind::Wait)), ter(t::Whitespaces), exp(expk::Expression)]),
    ]
}

const START_NODE: GrammarExpandableKind = GrammarExpandableKind::Document;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum GrammarExpandableKind {
    Document,
    Line,
    Lines,
    LineSuffix,
    Element,
    
    Expression,
    ExpressionValue,
    ExpressionInner,
    Operator,
    OperatorSuffix,
    String,
    Unit,
    Number,
    Value,
    ValueSuffix,
    Sign,
    Amount,
    AmountSuffix,
    Ident,
    ContainerId,
    MaterialId,
    VariableId,
    Container,
    Material,
    Variable,

    Definition,
    DefinitionInfix,

    FileInfo,
    Author,
    Version,
    Name,
    Output,
    GlobalTemperature,
    GlobalHumidity,

    Instruction,
    Transfer,
    Fill,
    // Centrifuge,
    Temperature,
    Wait
}

pub type TerminalKind = TokenKind;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum GrammarNode {
    Expandable(GrammarExpandableKind),
    Terminal(TerminalKind)
}

#[derive(Clone, Debug)]
pub struct AstTreeNode {
    pub kind: GrammarNode,
    pub token_string: String,
    parent: Option<usize>,
    pub child_indices: Vec<usize>,
    is_done: bool
}

/// LL(1) Parsing
struct Parser<'a> {
    input: &'a str,
    tokens: Vec<Token>,
    pos: usize,
    predict_map: HashMap<GrammarExpandableKind, HashSet<TerminalKind>>
}

impl<'a> Parser<'a> {
    fn new(input: &str, tokens: Vec<Token>) -> Parser {
        Parser { input, tokens, pos: 0, predict_map: HashMap::new() }
    }

    fn bump(&mut self) -> Option<Token> {
        if self.tokens.len() > 0 {
            self.pos += self.tokens.get(0).unwrap().len;
            Some(self.tokens.remove(0))
        } else {
            None
        }
    }

    fn get_current_token_str(&self) -> &'a str {
        if self.tokens.len() == 0 {
            ""
        } else {
            &self.input[self.pos..self.pos + self.tokens.get(0).unwrap().len]
        }
    }

    fn create_first_map(&self) -> HashMap<GrammarExpandableKind, HashSet<TerminalKind>> {
        let grammar = get_grammar();

        let mut first_map: HashMap<GrammarExpandableKind, HashSet<GrammarNode>> = HashMap::new();
        for rule in grammar.iter() {
            let mut values = if let Some(entry) = first_map.get(&rule.0) {
                    entry.to_owned()
                } else {
                    HashSet::new()
                };
            if rule.1.len() == 0 {
                panic!("Invalid Grammar for Language, cannot parse empty rule");
            }
            values.insert(rule.1.get(0).unwrap().clone());
            first_map.insert(rule.0.clone(), values);
        }
        let mut map_complete = false;
        while !map_complete {
            map_complete = true;
            for rule in grammar.iter() {
                let nodes = match first_map.get(&rule.0) {
                    Some(val) => val,
                    None => panic!("Unable to parse because first map key disappeared")
                };
                let mut new_nodes = vec![];
                for node in nodes.clone().into_iter() {
                    if let GrammarNode::Expandable(expandable) = node {
                        if let Some(val) = first_map.get(&expandable) {
                            new_nodes.extend(val.clone().into_iter());
                        };
                    }
                }
                if let Some(val_mut) = first_map.get_mut(&rule.0) {
                    let size_before = val_mut.len();
                    // val_mut.retain(|value| matches!(value, GrammarNode::Terminal(_)));
                    val_mut.extend(new_nodes);
                    if size_before != val_mut.len() {
                        map_complete = false;
                    }
                }
            }
        }

        first_map.into_iter().map(|(key, value_set)| {
            let terminal_set = value_set.into_iter().filter_map(|value| {
                if let GrammarNode::Terminal(terminal) = value {
                    Some(terminal)
                } else {
                    None
                }
            }).collect::<HashSet<TerminalKind>>();
            (key, terminal_set)
        }).collect::<HashMap<GrammarExpandableKind, HashSet<TerminalKind>>>()
    }

    fn _create_follow_map(&self, first_map: &HashMap<GrammarExpandableKind, HashSet<TerminalKind>>) -> HashMap<GrammarExpandableKind, HashSet<TerminalKind>> {
        let grammar = get_grammar();

        // FOLLOW MAP useful if epsilon can be in sets
        let mut follow_map: HashMap<GrammarExpandableKind, HashSet<TerminalKind>> = HashMap::from_iter(
            grammar.iter().map(|(key, _)| {
                (key.clone(), HashSet::new())
            })
        );
        follow_map.insert(START_NODE, HashSet::from([TerminalKind::Eof]));
        
        let mut map_complete = false;
        while !map_complete {
            map_complete = true;
            for rule in grammar.iter() {
                let head = rule.0.clone();
                let nodes = rule.1.clone();
                for (i, node) in nodes.iter().enumerate() {
                    if let GrammarNode::Expandable(expandable) = node {
                        match nodes.get(i + 1) {
                            Some(next_node) => {
                                match next_node {
                                    GrammarNode::Terminal(next_terminal) => {
                                        if let Some(val_mut) = follow_map.get_mut(expandable) {
                                            map_complete &= !val_mut.insert(next_terminal.clone());
                                        }
                                    },
                                    GrammarNode::Expandable(next_expandable) => {
                                        if let Some(val_mut) = follow_map.get_mut(expandable) {
                                            match first_map.get(next_expandable) {
                                                Some(first_set) => {
                                                    let size_before = val_mut.len();
                                                    val_mut.extend(first_set.clone().into_iter());
                                                    map_complete &= val_mut.len() == size_before;
                                                },
                                                None => ()
                                            }
                                        }
                                    }
                                }
                            },
                            None => {
                                if let Some(head_follow_set) = follow_map.get(&head).cloned() {
                                    if let Some(val_mut) = follow_map.get_mut(expandable) {
                                        let size_before = val_mut.len();
                                        val_mut.extend(head_follow_set.clone().into_iter());
                                        map_complete &= val_mut.len() == size_before;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        follow_map
    }

    fn generate_predict_set(&mut self) {
        self.predict_map = self.create_first_map();

        let grammar = get_grammar();
        let mut map_ambiguity: HashMap<GrammarExpandableKind, Vec<GrammarNode>> = HashMap::new();
        for (expandable, expand_to) in grammar.into_iter() {
            if let Some(val_mut) = map_ambiguity.get_mut(&expandable) {
                val_mut.push(expand_to.get(0).unwrap().clone());
            } else {
                map_ambiguity.insert(expandable, vec![expand_to.get(0).unwrap().clone()]);
            }
        }
        for (key, values) in map_ambiguity.into_iter() {
            let combination_set = values.clone().into_iter()
                .map(|value| match value {
                    GrammarNode::Expandable(expandable) =>
                        self.predict_map.get(&expandable)
                            .unwrap()
                            .into_iter()
                            .map(|x| x.clone())
                            .collect::<Vec<TerminalKind>>(),
                    GrammarNode::Terminal(terminal) => vec![terminal]
                })
                .map(|vector| vector.into_iter())
                .flatten()
                .collect::<Vec<TerminalKind>>();
            let size_before = combination_set.len();
            
            let joined_set = combination_set.clone().into_iter()
                .collect::<HashSet<TerminalKind>>();
            let size_after_joining: usize = joined_set.len();
            if size_before != size_after_joining {
                println!("ERROR: Ambiguity found for node: {:?}, expanding to -> {:?}", key, combination_set);
            }
        }
    }

    fn create_abstract_syntax_tree(&mut self) -> Result<Vec<AstTreeNode>, String> {
        let mut tree = vec![AstTreeNode {
            kind: exp(START_NODE),
            token_string: String::new(),
            parent: None,
            child_indices: vec![],
            is_done: false
        }];
        let mut current_tree_index: isize = 0;
        if self.predict_map.is_empty() {
            return Err(String::from("Predict map is empty"))
        }

        let grammar = get_grammar();

        let mut grammar_nodes = vec![exp(START_NODE)];
        while let Some(token_peek) = self.tokens.get(0) {
            loop {
                if current_tree_index == -1 {
                    break
                }
                let current_node = &tree[current_tree_index as usize];
                if current_node.is_done {
                    current_tree_index = match current_node.parent {
                        Some(parent) => parent as isize,
                        None => -1
                    };
                } else if matches!(current_node.kind, GrammarNode::Expandable(_))
                && current_node.child_indices.len() == 0 {
                    break
                } else {
                    let mut all_children_done = true;
                    for child_index in current_node.child_indices.iter() {
                        let child = &tree[*child_index];
                        all_children_done &= child.is_done;
                        if !child.is_done {
                            current_tree_index = *child_index as isize;
                            break
                        }
                    }
                    if all_children_done {
                        let current_node = tree.get_mut(current_tree_index as usize).unwrap();
                        current_node.is_done = true;
                    } else {
                        break
                    }
                }
            }
            if current_tree_index == -1 {
                break
            }
            let current_node = &tree[current_tree_index as usize];
            match &current_node.kind {
                GrammarNode::Expandable(expandable_node) => {
                    // println!("Exapndable here");
                    let rules = grammar.iter().filter(|rule| {
                        rule.0 == *expandable_node
                    }).collect::<Vec<&(GrammarExpandableKind, Vec<GrammarNode>)>>();
                    // println!("The possible rules are: {:?}", rules);

                    let rule = if rules.len() == 0 {
                            return Err(format!("Unable to find rules for expandable {:?}", expandable_node))
                        } else if rules.len() == 1 {
                            rules.get(0).unwrap()
                        } else {
                            let mut working_rule = None;
                            for rule in rules {
                                if let Some(first) = rule.1.get(0) {
                                    let first_terminals = match first {
                                        GrammarNode::Expandable(first_expandable) => {
                                            match self.predict_map.get(first_expandable) {
                                                Some(val) => val.clone(),
                                                None => return Err(format!("Predict map is missing expandables for {:?}", first_expandable))
                                            }
                                        },
                                        GrammarNode::Terminal(first_terminal) => HashSet::from([first_terminal.clone()])
                                    };

                                    if first_terminals.into_iter().any(|terminal| terminal == token_peek.kind) {
                                        if working_rule.is_some() {
                                            return Err(String::from("Ambiguous rule in grammar, unable to parse"))
                                        }
                                        working_rule = Some(rule);
                                    }
                                } else {
                                    return Err(format!("Invalid rule in grammar for exandable {:?}", expandable_node))
                                }
                            }

                            if let Some(rule) = working_rule {
                                rule
                            } else {
                                return Err(format!("Unable to find any rule for the expandable {:?}", expandable_node))
                            }
                        };
                    
                    grammar_nodes.extend(rule.1.clone().into_iter().rev());
                    let mut new_indices = vec![];
                    for new_node in rule.1.clone().into_iter() {
                        let new_child = AstTreeNode {
                            kind: new_node,
                            token_string: String::new(),
                            parent: Some(current_tree_index as usize),
                            child_indices: vec![],
                            is_done: false
                        };
                        tree.push(new_child);
                        new_indices.push(tree.len() - 1);
                    }
                    let mut_current = tree.get_mut(current_tree_index as usize).unwrap();
                    mut_current.child_indices.extend(new_indices);
                },
                GrammarNode::Terminal(terminal) => {
                    if *terminal == token_peek.kind {
                        let mut_current = tree.get_mut(current_tree_index as usize).unwrap();
                        mut_current.is_done = true;
                        mut_current.token_string = self.get_current_token_str().to_string();
                        self.bump();
                    } else {
                        return Err(format!("Invalid token {:?}", terminal))
                    }
                }
            }
        }

        if self.tokens.len() == 0 {
            Ok(tree)
        } else {
            return Err(String::from("Parsing did not use all tokens"))
        }
    }
}

fn format_ast_tree(tree: &[AstTreeNode]) -> String {
    fn fmt_node(tree: &[AstTreeNode], index: usize, indent: usize, out: &mut String) {
        if let Some(node) = tree.get(index) {
            let indent_str = "  ".repeat(indent);
            let kind_str = match &node.kind {
                GrammarNode::Expandable(expandable) => format!("{:?}", expandable),
                GrammarNode::Terminal(terminal) => format!("{:?}", terminal)
            };
            if node.token_string.is_empty() {
                out.push_str(&format!("{}- {}\n", indent_str, kind_str));
            } else {
                out.push_str(&format!("{}- {}: \"{}\"\n", indent_str, kind_str, node.token_string));
            }
            for &child_index in &node.child_indices {
                fmt_node(tree, child_index, indent + 1, out);
            }
        }
    }

    let mut output = String::new();
    if !tree.is_empty() {
        fmt_node(tree, 0, 0, &mut output);
    }
    output
}

pub fn parse_token_into_ast<'a>(input: &'a str, tokens: Vec<Token>) -> Result<Vec<AstTreeNode>, String> {
    let mut parser = Parser::new(input, tokens.clone());
    parser.generate_predict_set();
    let result = parser.create_abstract_syntax_tree();
    
    // match &result {
    //     Ok(ast) => println!("{}", format_ast_tree(ast)),
    //     Err(err) => println!("Error: {}", err)
    // }

    // let mut pos = 0;
    // for token in parser.tokens.into_iter() {
    //     pos += token.len;
    // }
    // let token_str = &input[(input.len() - pos)..];
    // print!("Unparsed: \"{}\"", token_str);

    result
}
