use std::str::Chars;


const EOF_CHAR: char = '\0';

#[derive(PartialEq, Debug, Clone)]
pub enum UnitKind {
    Temperature,
    Duration,
    Mass,
    Volume,
    OpticalDensity,
    CentrifugalForce,
    Molar,
    ColonyCount,
}

#[derive(PartialEq, Debug, Clone)]
pub enum LiteralKind {
    Int,
    Float,
    Version,
    Str,
    Unit(UnitKind),
}

#[derive(PartialEq, Debug, Clone)]
pub enum TokenKind {
    LineComment,
    BlockComment,
    Whitespaces,
    NewLine,
    Literal(LiteralKind),
    At,
    Pound,
    Tilde,
    Question,
    Eq,
    Lt,
    Gt,
    Unknown,
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
    matches!(
        c,
        // End-of-line characters
        | '\u{000B}' // vertical tab
        | '\u{000C}' // form feed
        | '\u{000D}' // carriage return (\r)
        | '\u{0085}' // next line (from latin1)
        | '\u{2028}' // LINE SEPARATOR
        | '\u{2029}' // PARAGRAPH SEPARATOR

        // `Default_Ignorable_Code_Point` characters
        | '\u{200E}' // LEFT-TO-RIGHT MARK
        | '\u{200F}' // RIGHT-TO-LEFT MARK

        // Horizontal space characters
        | '\u{0009}'   // tab (\t)
        | '\u{0020}' // space
    )
}

fn is_digit(c: char) -> bool {
    matches!(c, '0'..='9')
}

fn is_variable_like(c: char) -> bool {
    matches!(
        c.to_ascii_lowercase(),
        'a'..='z'
        | '_'
        | 'ö'
        | 'ä'
        | 'ü'
        | '!'
        | '°'
        | 'µ'
        | '×'
    )
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
    fn line_comment(&mut self) -> TokenKind {
        self.eat_until(b'\n');
        TokenKind::LineComment
    }
    fn block_comment(&mut self) -> TokenKind {
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
        TokenKind::BlockComment
    }
    fn whitespace(&mut self) -> TokenKind {
        self.eat_while(is_whitespace);
        TokenKind::Whitespaces
    }
    fn literal_number_like(&mut self) -> TokenKind {
        self.eat_while(is_digit);
        if self.first() == '%' { // 82%
            self.bump();
            return TokenKind::Literal(LiteralKind::Float);
        }
        if self.first() != '.' || !is_digit(self.second()) { // 1732
            return TokenKind::Literal(LiteralKind::Int);
        }
        self.bump();
        self.eat_while(is_digit);
        if self.first() == '%' { // 1841.283%
            self.bump();
            return TokenKind::Literal(LiteralKind::Float);
        }
        if self.first() != '.' || !is_digit(self.second()) { // 18471.192
            return TokenKind::Literal(LiteralKind::Float);
        }
        self.bump();
        self.eat_while(is_digit);
        TokenKind::Literal(LiteralKind::Version) // 193.131.23
    }
    fn literal_word_like(&mut self) -> TokenKind {
        // Str
        // Units:
        //   Temperature: °C, C, K , °F , F , celsius, kelvin, fahrenheit
        //   Duration:
        //     y, yr, yrs, year, years
        //     mo, mon, mth, month, months
        //     w, wk, wks, week, weeks
        //     d, day, days
        //     h, hr, hrs, hour, hours
        //     m, min, mins, minute, minutes
        //     s, sec, secs, second, seconds
        //     ms, msec, millisecond, milliseconds
        //     µs, us, microscond, microsconds
        //   Mass:
        //     kg, kilogram, kilograms
        //     g, gm, gram, grams
        //     mg, milligram, milligrams
        //     µg, ug, mcg, microgram, micrograms
        //     ng, nanogram, nanograms
        //     pg, picogram, picograms
        //     lb, lbs, oz
        //   Volume:
        //     l, liter, liters
        //     ml, milliliter, milliliters
        //     µl, ul, microliter, microliters
        //     nl, nanoliter, nanoliters
        //     cm³, cm3, cc
        //   OpticalDensity: OD, O.D., optical density, AU, absorption unit, absorption, optical
        //   CentrifugalForce: g, gs, xg, xgs, x g, x gs, ×g, ×gs, × g, × gs, rcf
        //   Molar:
        //     M, molar, molars
        //     mM, millimolar
        //     µM, uM, micromolar, micromolars
        //     nM, nanomolar
        //     pM, picomolar
        //     mol/L, mmol/l, µmol/l, umol/l
        //   ColonyCount: cfu, cfus, colonies, colony, count, pfu, pfus
        self.eat_while(is_variable_like);
        TokenKind::Literal(LiteralKind::Str)
    }
    fn advance_token(&mut self) -> Token {
        let char = match self.bump() {
            Some(c) => c,
            None => return Token::new(TokenKind::Eof, 0)
        };
        let token_kind = match char {
            '/' => match self.first() {
                '/' => self.line_comment(),
                '*' => self.block_comment(),
                _ => TokenKind::Unknown
            },
            ' ' => self.whitespace(),
            '\n' => TokenKind::NewLine,
            '@' => TokenKind::At,
            '#' => TokenKind::Pound,
            '~' => TokenKind::Tilde,
            '=' => TokenKind::Eq,
            '<' => TokenKind::Lt,
            '>' => TokenKind::Gt,
            '?' => TokenKind::Question,
            '&' => TokenKind::And,
            '|' => TokenKind::Or,
            '0'..='9' => self.literal_number_like(),
            _ if is_variable_like(char) => self.literal_word_like(),
            _ => TokenKind::Unknown,
        };
        let token = Token::new(token_kind, self.pos_within_token());
        self.reset_pos_within_token();

        token
    }
}

pub fn tokenize<'a>(input: &'a str) -> impl Iterator<Item = Token> + 'a {
    let mut cursor = Cursor::new(input);
    std::iter::from_fn(move || {
        let token = cursor.advance_token();
        if token.kind != TokenKind::Eof { Some(token) } else { None }
    })
}
