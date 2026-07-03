use std::str::Chars;

use crate::core::units::Unit;


const EOF_CHAR: char = '\0';

const KEYWORD_MAP: &[(&str, KeywordKind)] = &[
    ("author", KeywordKind::InfoAuthor),
    ("version", KeywordKind::InfoVersion),
    ("name", KeywordKind::InfoName),
    ("global_temperature", KeywordKind::InfoTemperature),
    ("global_humidity", KeywordKind::InfoHumidity),

    ("define", KeywordKind::Define),
    ("pressure", KeywordKind::Pressure),
    ("temperature", KeywordKind::Temperature),
    ("transfer", KeywordKind::Transfer),
    ("fill", KeywordKind::Fill),
    ("wait", KeywordKind::Wait),

    ("with", KeywordKind::With),
    ("using", KeywordKind::Using),
    ("as", KeywordKind::As),
    ("of", KeywordKind::Of),
    ("into", KeywordKind::Into),
    ("from", KeywordKind::From),
    ("to", KeywordKind::To)
];

// String, Unit kind, multiplicative factor, additive factor
pub const UNIT_MAP: &[(&str, Unit, fn(f64) -> f64)] = &[
    ("°C", Unit::Temperature, |x| x),
    ("C", Unit::Temperature, |x| x),
    ("K", Unit::Temperature, |x| x - 273.15),
    ("°F", Unit::Temperature, |x| (x - 32.0) / 1.8),
    ("F", Unit::Temperature, |x| (x - 32.0) / 1.8),
    ("Celsius", Unit::Temperature, |x| x),
    ("celsius", Unit::Temperature, |x| x),
    ("Kelvin", Unit::Temperature, |x| x - 273.15),
    ("kelvin", Unit::Temperature, |x| x - 273.15),
    ("Fahrenheit", Unit::Temperature, |x| (x - 32.0) / 1.8),
    ("fahrenheit", Unit::Temperature, |x| (x - 32.0) / 1.8),

    ("y", Unit::Duration, |x| 365.25 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("yr", Unit::Duration, |x| 365.25 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("yrs", Unit::Duration, |x| 365.25 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("year", Unit::Duration, |x| 365.25 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("years", Unit::Duration, |x| 365.25 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("mo", Unit::Duration, |x| 30.44 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("mon", Unit::Duration, |x| 30.44 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("mth", Unit::Duration, |x| 30.44 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("month", Unit::Duration, |x| 30.44 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("months", Unit::Duration, |x| 30.44 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("w", Unit::Duration, |x| 7.0 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("wk", Unit::Duration, |x| 7.0 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("wks", Unit::Duration, |x| 7.0 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("week", Unit::Duration, |x| 7.0 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("weeks", Unit::Duration, |x| 7.0 * 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("d", Unit::Duration, |x| 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("day", Unit::Duration, |x| 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("days", Unit::Duration, |x| 24.0 * 60.0 * 60.0 * 1000.0 * x),
    ("h", Unit::Duration, |x| 60.0 * 60.0 * 1000.0 * x),
    ("hr", Unit::Duration, |x| 60.0 * 60.0 * 1000.0 * x),
    ("hrs", Unit::Duration, |x| 60.0 * 60.0 * 1000.0 * x),
    ("hour", Unit::Duration, |x| 60.0 * 60.0 * 1000.0 * x),
    ("hours", Unit::Duration, |x| 60.0 * 60.0 * 1000.0 * x),
    ("m", Unit::Duration, |x| 60.0 * 1000.0 * x),
    ("min", Unit::Duration, |x| 60.0 * 1000.0 * x),
    ("mins", Unit::Duration, |x| 60.0 * 1000.0 * x),
    ("minute", Unit::Duration, |x| 60.0 * 1000.0 * x),
    ("minutes", Unit::Duration, |x| 60.0 * 1000.0 * x),
    ("s", Unit::Duration, |x| 1000.0 * x),
    ("sec", Unit::Duration, |x| 1000.0 * x),
    ("secs", Unit::Duration, |x| 1000.0 * x),
    ("second", Unit::Duration, |x| 1000.0 * x),
    ("seconds", Unit::Duration, |x| 1000.0 * x),
    ("ms", Unit::Duration, |x| x),
    ("msec", Unit::Duration, |x| x),
    ("millisecond", Unit::Duration, |x| x),
    ("milliseconds", Unit::Duration, |x| x),
    ("µs", Unit::Duration, |x| 0.001 * x),
    ("us", Unit::Duration, |x| 0.001 * x),
    ("microscond", Unit::Duration, |x| 0.001 * x),
    ("microsconds", Unit::Duration, |x| 0.001 * x),

    ("kg", Unit::Mass, |x| 1000_000.0 * x),
    ("kilogram", Unit::Mass, |x| 1000_000.0 * x),
    ("kilograms", Unit::Mass, |x| 1000_000.0 * x),
    ("g", Unit::Mass, |x| 1000.0 * x),
    ("gm", Unit::Mass, |x| 1000.0 * x),
    ("gram", Unit::Mass, |x| 1000.0 * x),
    ("grams", Unit::Mass, |x| 1000.0 * x),
    ("mg", Unit::Mass, |x| x),
    ("milligram", Unit::Mass, |x| x),
    ("milligrams", Unit::Mass, |x| x),
    ("µg", Unit::Mass, |x| 0.001 * x),
    ("ug", Unit::Mass, |x| 0.001 * x),
    ("mcg", Unit::Mass, |x| 0.001 * x),
    ("microgram", Unit::Mass, |x| 0.001 * x),
    ("micrograms", Unit::Mass, |x| 0.001 * x),
    ("ng", Unit::Mass, |x| 0.000_001 * x),
    ("nanogram", Unit::Mass, |x| 0.000_001 * x),
    ("nanograms", Unit::Mass, |x| 0.000_001 * x),
    ("pg", Unit::Mass, |x| 0.000_000_001 * x),
    ("picogram", Unit::Mass, |x| 0.000_000_001 * x),
    ("picograms", Unit::Mass, |x| 0.000_000_001 * x),
    ("lb", Unit::Mass, |x| 453592.0 * x),
    ("lbs", Unit::Mass, |x| 453592.0 * x),
    ("oz", Unit::Mass, |x| 28349.5 * x),

    ("l", Unit::Volume, |x| 1000_000.0 * x),
    ("L", Unit::Volume, |x| 1000_000.0 * x),
    ("liter", Unit::Volume, |x| 1000_000.0 * x),
    ("liters", Unit::Volume, |x| 1000_000.0 * x),
    ("ml", Unit::Volume, |x| 1000.0 * x),
    ("mL", Unit::Volume, |x| 1000.0 * x),
    ("milliliter", Unit::Volume, |x| 1000.0 * x),
    ("milliliters", Unit::Volume, |x| 1000.0 * x),
    ("cm³", Unit::Volume, |x| 1000.0 * x),
    ("cm3", Unit::Volume, |x| 1000.0 * x),
    ("cc", Unit::Volume, |x| 1000.0 * x),
    ("µl", Unit::Volume, |x| x),
    ("µL", Unit::Volume, |x| x),
    ("ul", Unit::Volume, |x| x),
    ("uL", Unit::Volume, |x| x),
    ("microliter", Unit::Volume, |x| x),
    ("microliters", Unit::Volume, |x| x),
    ("nl", Unit::Volume, |x| 0.001 * x),
    ("nL", Unit::Volume, |x| 0.001 * x),
    ("nanoliter", Unit::Volume, |x| 0.001 * x),
    ("nanoliters", Unit::Volume, |x| 0.001 * x),

    ("OD", Unit::OD, |x| x),
    ("O.D.", Unit::OD, |x| x),
    ("optical density", Unit::OD, |x| x),
    ("AU", Unit::OD, |x| x),
    ("absorption unit", Unit::OD, |x| x),
    ("absorption", Unit::OD, |x| x),
    ("optical", Unit::OD, |x| x),

    ("g", Unit::CentrifugalForce, |x| x),
    ("gs", Unit::CentrifugalForce, |x| x),
    ("xg", Unit::CentrifugalForce, |x| x),
    ("xgs", Unit::CentrifugalForce, |x| x),
    ("x g", Unit::CentrifugalForce, |x| x),
    ("x gs", Unit::CentrifugalForce, |x| x),
    ("×g", Unit::CentrifugalForce, |x| x),
    ("×gs", Unit::CentrifugalForce, |x| x),
    ("× g", Unit::CentrifugalForce, |x| x),
    ("× gs", Unit::CentrifugalForce, |x| x),
    ("rcf", Unit::CentrifugalForce, |x| x),

    ("M", Unit::Molar, |x| x),
    ("molar", Unit::Molar, |x| x),
    ("molars", Unit::Molar, |x| x),
    ("mol/l", Unit::Molar, |x| x),
    ("mol/L", Unit::Molar, |x| x),
    ("mM", Unit::Molar, |x| 0.001 * x),
    ("millimolar", Unit::Molar, |x| 0.001 * x),
    ("mmol/l", Unit::Molar, |x| 0.001 * x),
    ("mmol/L", Unit::Molar, |x| 0.001 * x),
    ("µM", Unit::Molar, |x| 0.000_001 * x),
    ("uM", Unit::Molar, |x| 0.000_001 * x),
    ("micromolar", Unit::Molar, |x| 0.000_001 * x),
    ("micromolars", Unit::Molar, |x| 0.000_001 * x),
    ("µmol/l", Unit::Molar, |x| 0.000_001 * x),
    ("µmol/L", Unit::Molar, |x| 0.000_001 * x),
    ("umol/l", Unit::Molar, |x| 0.000_001 * x),
    ("umol/L", Unit::Molar, |x| 0.000_001 * x),
    ("nM", Unit::Molar, |x| 0.000_000_001 * x),
    ("nanomolar", Unit::Molar, |x| 0.000_000_001 * x),
    ("pM", Unit::Molar, |x| 0.000_000_000_001 * x),
    ("picomolar", Unit::Molar, |x| 0.000_000_000_001 * x),

    ("cfu", Unit::ColonyCount, |x| x),
    ("CFU", Unit::ColonyCount, |x| x),
    ("cfus", Unit::ColonyCount, |x| x),
    ("CFUs", Unit::ColonyCount, |x| x),
    ("colonies", Unit::ColonyCount, |x| x),
    ("colony", Unit::ColonyCount, |x| x),
    ("count", Unit::ColonyCount, |x| x),
    ("pfu", Unit::ColonyCount, |x| x),
    ("PFU", Unit::ColonyCount, |x| x),
    ("pfus", Unit::ColonyCount, |x| x),
    ("PFUs", Unit::ColonyCount, |x| x),
];

#[derive(PartialEq, Debug, Clone, Eq, Hash)]
pub enum KeywordKind {
    InfoAuthor,
    InfoVersion,
    InfoName,
    InfoTemperature,
    InfoHumidity,

    Define,
    Pressure,
    Temperature,
    Transfer,
    Fill,
    Wait,

    From,
    To,
    As,
    Of,
    Into,
    With,
    Using
}

#[derive(PartialEq, Debug, Clone, Eq, Hash)]
pub enum LiteralKind {
    Int,
    Float,
    Version,
    Str,
}

#[derive(PartialEq, Debug, Clone, Eq, Hash)]
pub enum TokenKind {
    Keyword(KeywordKind),
    Literal(LiteralKind),
    Unit(Unit),

    At,
    Pound,
    Dollar,

    Tilde,
    Eq,
    Le,
    Lt,
    Ge,
    Gt,

    Plus,
    Minus,
    Times,
    Divided,
    LeftBracket,
    RightBracket,

    Whitespaces,
    NewLine,
    Eof
}

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: TokenKind,
    pub len: usize
}

struct Cursor<'a> {
    chars: Chars<'a>,
    len_remaining: usize
}

fn is_whitespace(c: char) -> bool {
    c == ' ' || c == '\t' || c == '\r'
}

fn is_digit(c: char) -> bool {
    matches!(c, '0'..='9')
}

fn is_word_like(c: char) -> bool {
    matches!(
        c.to_ascii_lowercase(),
        'a'..='z'
        | '0'..='9'
        | '_'
        | 'ö'
        | 'ä'
        | 'ü'
        | '°'
        | 'µ'
        | '×'
    )
}

fn find_hashmap_key_match_keywords(input: &str) -> Option<KeywordKind> {
    for (key, kind) in KEYWORD_MAP.iter() {
        if *input == **key {
            return Some((*kind).clone());
        }
    }
    None
}
fn find_hashmap_key_match_units(input: &str) -> Option<Unit> {
    for (key, kind, _conversion_fn) in UNIT_MAP.iter() {
        if *input == **key {
            return Some((*kind).clone());
        }
    }
    None
}

impl Token {
    fn new(kind: TokenKind, len: usize) -> Token {
        Token {
            kind,
            len
        }
    }
}

impl<'a> Cursor<'a> {
    fn new(input: &'a str) -> Cursor<'a> {
        Cursor {
            chars: input.chars(),
            len_remaining: input.len()
        }
    }
    fn as_str(&self) -> &'a str {
        self.chars.as_str()
    }
    fn bump(&mut self) -> Option<char> {
        self.chars.next()
    }
    fn pos_within_token(&mut self) -> usize {
        self.len_remaining - self.chars.as_str().len()
    }
    fn reset_pos_within_token(&mut self) {
        self.len_remaining = self.chars.as_str().len();
    }
    fn first(&self) -> char {
        self.chars.clone().next().unwrap_or(EOF_CHAR)
    }
    fn second(&self) -> char {
        let mut iter = self.chars.clone();
        iter.next();
        iter.next().unwrap_or(EOF_CHAR)
    }
    fn third(&self) -> char {
        let mut iter = self.chars.clone();
        iter.next();
        iter.next();
        iter.next().unwrap_or(EOF_CHAR)
    }
    fn is_eof(&self) -> bool {
        self.chars.as_str().is_empty()
    }
    fn eat_until(&mut self, byte: u8) {
        self.chars = match memchr::memchr(byte, self.as_str().as_bytes()) {
            Some(index) => self.as_str()[index..].chars(),
            None => "".chars(),
        }
    }
    fn eat_while(&mut self, mut predicate: impl FnMut(char) -> bool) {
        while predicate(self.first()) && !self.is_eof() {
            self.bump();
        }
    }
    fn line_comment(&mut self) {
        self.eat_until(b'\n');
    }
    fn block_comment(&mut self) {
        let mut depth = 1usize;
        while let Some(c) = self.bump() {
            match c {
                '/' if self.first() == '*' => {
                    self.bump();
                    depth += 1;
                },
                '*' if self.first() == '/' => {
                    self.bump();
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                },
                _ => ()
            }
        }
    }
    fn whitespace(&mut self) -> TokenKind {
        self.eat_while(is_whitespace);
        TokenKind::Whitespaces
    }
    fn number_like(&mut self) -> Result<TokenKind, String> {
        self.eat_while(is_digit);
        if self.first() == '%' { // 82%
            self.bump();
            return Ok(TokenKind::Literal(LiteralKind::Float));
        }
        if self.first() != '.' || !is_digit(self.second()) { // 1732
            return Ok(TokenKind::Literal(LiteralKind::Int));
        }
        self.bump();
        self.eat_while(is_digit);
        if self.first() == '%' { // 1841.283%
            self.bump();
            return Ok(TokenKind::Literal(LiteralKind::Float));
        }
        if self.first() != '.' || !is_digit(self.second()) { // 18471.192
            return Ok(TokenKind::Literal(LiteralKind::Float));
        }
        self.bump();
        self.eat_while(is_digit);
        Ok(TokenKind::Literal(LiteralKind::Version)) // 193.131.23
    }
    fn word_like(&mut self, first_char: char) -> Result<TokenKind, String> {
        let start_str = String::from(first_char) + self.as_str();
        self.eat_while(is_word_like);

        let total_len = self.pos_within_token();
        let token_str = &start_str[..total_len];

        if let Some(token_kind) = find_hashmap_key_match_keywords(&token_str.to_ascii_lowercase()) {
            Ok(TokenKind::Keyword(token_kind))
        } else if let Some(token_kind) = find_hashmap_key_match_units(token_str) {
            Ok(TokenKind::Unit(token_kind))
        } else {
            Ok(TokenKind::Literal(LiteralKind::Str))
        }
    }
    fn advance_token(&mut self) -> Result<Token, String> {
        let char = match self.bump() {
            Some(c) => c,
            None => return Ok(Token::new(TokenKind::Eof, 0))
        };
        let token_kind = match char {
            '0'..='9' => match self.number_like() {
                Ok(val) => val,
                Err(err) => return Err(err)
            },
            '@' => TokenKind::At,
            '#' => TokenKind::Pound,
            '$' => TokenKind::Dollar,
            '~' => TokenKind::Tilde,
            '=' => TokenKind::Eq,
            '<' if self.first() == '=' => {
                self.bump();
                TokenKind::Le
            },
            '<' => TokenKind::Lt,
            '>' if self.first() == '=' => {
                self.bump();
                TokenKind::Ge
            },
            '>' => TokenKind::Gt,
            '+' => TokenKind::Plus,
            '-' => TokenKind::Minus,
            '*' => TokenKind::Times,
            '/' => {
                match self.first() {
                    '/' => {
                        self.line_comment();
                        TokenKind::Whitespaces
                    },
                    '*' => {
                        self.block_comment();
                        TokenKind::Whitespaces
                    },
                    _ => TokenKind::Divided
                }
            },
            '(' => TokenKind::LeftBracket,
            ')' => TokenKind::RightBracket,
            '\n' => TokenKind::NewLine,
            _ if is_word_like(char) => match self.word_like(char) {
                Ok(val) => val,
                Err(err) => return Err(err)
            },
            _ if is_whitespace(char) => self.whitespace(),
            _ => return Err(format!("Invalid character \'{}\'", char)),
        };
        let token = Token::new(token_kind, self.pos_within_token());
        self.reset_pos_within_token();

        Ok(token)
    }
}

pub fn tokenize<'a>(input: &'a str) -> Result<impl Iterator<Item = Token> + 'a, String> {
    let mut cursor = Cursor::new(input);
    let mut tokens = Vec::new();
    loop {
        match cursor.advance_token() {
            Ok(token) => {
                if token.kind == TokenKind::Eof { break; }
                tokens.push(token);
            }
            Err(err) => return Err(err)
        }
    }
    Ok(tokens.into_iter())
}
