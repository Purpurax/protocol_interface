## Tokens
- **keywords**:
    - **Lab conditions**: author, version, name, temperature, humidity
    - **Instructions**: define, autoclave, temp, repeat, from, to, transfer, with
    - **Intermediates**: as, of, into, from, to
- **literal**:
    - **number**: int, float
    - **version**
    - **string**
- whitespaces
- newline
- eof
- **other**: @, #, $, ~, <, >, =, <=, >=, ?

## Grammar
Document -> Line* "eof"
Line -> (Definitions | FileInfo | Operation)? "line comment"? ("new line" | "eof")

String -> "literal" ("whitespaces" "literal")+
Unit -> String
Value -> ("other ~" | "other <" | "other >" | "other =" | "other <=" | "other >=")? "whitespaces"? "literal number"
Amount -> Value "whitespaces"? Unit
Ident -> String
ContainerId -> "other #" "whitespaces" "literal number int"
MaterialId -> "other @" "whitespaces" "literal number int"
VariableId -> "other $" "whitespaces" "literal number int"
Container -> ContainerId | Ident
Material -> MaterialId | Ident
Variable -> VariableId | Ident

Definitions -> "keyword define" "whitespaces" (Container | Material | Variable | Ident) "whitespaces" "keyword as" "whitespaces" Ident

FileInfo -> "whitespaces" (Author | Version | Name | GeneralTemperature | Humidity) "whitespaces"

Author -> "keyword author" "whitespaces" String
Version -> "keyword version" "whitespaces" "literal version"
Name -> "keyword name" "whitespaces" String
GeneralTemperature -> "keyword general_temperature" "whitespaces" Amount
Humidity -> "keyword humidity" "whitespaces" Value

Operation -> "whitespaces" (Transfer | Centrifuge | Temperature | Wait) "whitespaces"
Transfer -> Amount "whitespaces" "keyword from" "whitespaces" String "whitespaces" "keyword to" "whitespaces" String
Centrifuge -> String "whitespaces" "keyword with" "whitespaces" Amount
Temperature -> "keyword temperature" "whitespaces" Container "whitespaces" "keyword to" "whitespaces" Amount
Wait -> "keyword wait" "whitespaces" Amount

## Semantics
1. Check for validity of definitions
2. Resolve definitions
3. Validate FileInfo (each should appear exactly once)
4. Validate Operations
