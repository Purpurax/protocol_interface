## Tokens
- **keywords**:
    - **Lab conditions**: author, version, name, temperature, humidity
    - **Instructions**: define, pressure, temp, transfer
    - **Intermediates**: with, as, of, into, from, to
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
Line -> "whitespaces" Expression? "whitespaces" "new line"
Expression -> Definitions | FileInfo | Operation

String -> "literal" ("whitespaces" "literal")*
Unit -> String
Number -> "literal int" | "literal float"
Value -> ("other ~" | "other <" | "other >" | "other =" | "other <=" | "other >=")? "whitespaces"? "literal number"
Amount -> Value "whitespaces"? Unit
Ident -> String
ContainerId -> "other #" "whitespaces"? "literal number int"
MaterialId -> "other @" "whitespaces"? "literal number int"
VariableId -> "other $" "whitespaces"? "literal number int"
Container -> ContainerId | Ident
Material -> MaterialId | Ident
Variable -> VariableId | Ident

Definitions -> "keyword define" "whitespaces" (Container | Material | Variable | Ident) "whitespaces" "keyword as" "whitespaces" Ident

FileInfo -> (Author | Version | Name | GeneralTemperature | Humidity)

Author -> "keyword author" "whitespaces" String
Version -> "keyword version" "whitespaces" "literal version"
Name -> "keyword name" "whitespaces" String
GeneralTemperature -> "keyword general_temperature" "whitespaces" Amount
Humidity -> "keyword humidity" "whitespaces" Value

Operation -> (Transfer | Centrifuge | Temperature | Wait)
Transfer -> Amount "whitespaces" "keyword from" "whitespaces" String "whitespaces" "keyword to" "whitespaces" String
Centrifuge -> String "whitespaces" "keyword with" "whitespaces" Amount
Temperature -> "keyword temperature" "whitespaces" Container "whitespaces" "keyword to" "whitespaces" Amount
Wait -> "keyword wait" "whitespaces" Amount

## Semantics
1. Check for validity of definitions
2. Resolve definitions
3. Validate FileInfo (each should appear exactly once)
4. Validate Operations

## UNITS
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

## Basic meta-instructions
- *Apply mechanical force*: Push, pull, shear, compress, or deform a substance. E.g. pipetting, mixing, homogenization, cell disruption.
- *Apply heat*: Increase the temperature of a substance. E.g. sterilization, heat lysis, incubation, melting.
- *Remove heat*: Decrease the temperature of a substance. E.g. refrigeration, freezing, cryopreservation.
- *Apply pressure*: Increase or decrease pressure around a substance. E.g. vacuum filtration, autoclaving, vacuum drying, freeze-drying.
- *Apply an electric field*: Expose a substance to an electric field or current. E.g. electroporation, electrophoresis, electrolysis.
- *Apply a magnetic field*: Expose a substance to magnetism. E.g. magnetic bead separation, magnetic cell sorting.
- *Apply electromagnetic radiation*: Irradiate a substance with photons. E.g. UV sterilization, fluorescence excitation, infrared heating, laser illumination.
- *Apply mechanical waves*: Transfer energy through vibration or sound waves. E.g. sonication, ultrasonic cleaning, vortexing, shaking.
- *Apply controlled fluid flow*: Force a liquid or gas to move. E.g. perfusion, pumping through filters, microfluidics, sparging.
