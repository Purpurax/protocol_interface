## Idea
The protocol system is meant for multiple purposes and rust code should combine all of them.

## Purposes
### Material tracking (data)
I want to have files which describe all materials that are in storage:
- How much is in stock
- What concentrations are available
- Is it a liquid
- What are the dangers when dealing with it
- How much does it cost
- Where can you order more
- Where is the material located
- For what can it be used for
- This organism has those components which interact this way

The **implementation** of basic material is straight forward and not discussed further. Composed material such as M9 medium is also relatively straight forward as you would simply take the meta material, use an instruction, and the output will be this medium at a certain concentration.
The actual difficult part is organisms. How can an organism be modelled to predict its behaviour as accurately as possible.

Using https://pubchem.ncbi.nlm.nih.gov/ as a chemical library. Using cas, you get the cid number using:
1. `curl -s "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{cas number}/cids/JSON" | jq '.IdentifierList.CID[0]'`
2. Use the number to grab data using `curl -s "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{CID number}/property/MolecularFormula,MolecularWeight,CanonicalSMILES/JSON"`

### Instructions (functions)
For each device I want to have instructions of how to use it and what is required. These can be seen as functions with exact steps. Either they can be performed manually or automatically by the biomation system. The goal is to have those instructions for any kind of use in any situation. During the process I also want to know what to expect, so what is going on under the hood in real time. So in experiments it would help to know when something should be seen, what to expect and when.
Instructions could be:
- **Move solutions around**:
    - **transfer**: Moving liquid between containers
    - **add**: Introducing a stock reagent, which triggers a recalculation of chemical state
    - **distribute**: Dispensing into multiple destination wells from a single large volume
    - **consolidate**: Collecting liquid from multple source wells into a single target vessel
- **mix**: Homogenizing through pipetting, stirring, vortexing, or shaking
- **centrifuge**: separate solutino into pellets and supernatant (or by density)
- **temperature control**:
    - **incubate**: Maintaining a stable temperature
    - **on_ice**: Rapid cooling to halt enzymatic activity and preventing degration
    - **heat_shock**: Precise timed temperature spike for organisms to take foreign nucleotides
    - **run_pcr**: Thermal cycles for nucleotide amplification
- **pick_colonies**: Identifying and pick colonies
- **adjust_ph**: Adding acid or base to get exact pH level
- **other**: manual, checkpoint 

As a side note the functions also have a global scope of basic variables like the room temperature, humidity, and facility at which it took place.

### Documentation (log)
The chronological events that took place with what material through which instructions lead to this result. This can't be done fully through code but the whole process description could be fully automated into natural language. So for each function the types must be logged. Either you have a continuous text format that completes over time, or you do it all at once.

## Features
- Protocol creation:
    - Web interface
- Protocol parsing:
    - 
- Protocol processing:

