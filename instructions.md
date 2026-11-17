General guidance:
- Use the README to know which features might come in the future but don't implement them, fokus on what is written here
- Turn this Rust project into a native Javascript/html/css project
- Because all previous Rust code is not relevant and outdated, feel free to wipe it (I have a git commit so don't worry)
- Do not commit or touch any written Git stuff
- Your task is to create the interface for the data warehouse project which is located in this workspace
- Only touch this interface folder and for any additional feature you need, create a single required.md file in which you describe what interface API call you would like to use and what functionality should be behind that call
- Inspire yourself from game like features to make the experience of using the interface interesting, so include visual effects, camera zooming, different layer modes (described later) and a non website like feeling and more game like feeling.
- This is going to be a developer interface, so don't do a fancy login system, just an interface that can run locally in conjunction with the warehouse if that runs in the background (if not wait until it loads)
- In the README.md at the bottom after (---), please document your progress/thoughts briefly

Interface overview:
- The Interface is a game inspired Warehouse system in 3d which has all required functionality to view the warehouse and its moving cargos in real time
- The user can use typical game keybinds to move around the warehouse world as they please and view the warehouse state in real time
- They can click on any element to view Its id and other important information. Because there are multiple different elements, you must differentiate between them and accordingly show the information. If done, the camera should somehow focus on that element and when clicking away, it should go back to normal. Cargos are moving, so camera should be tracking
- The user can switch between multiple different layers and go forward in time even. The layers include: normal view, labeled view (information about each cargo, so what it contains right below), touch view (mark all cargos that are anchored), prediction view in which the time can be forwarded to see the trajectory of what will move where, and setup view (in which the models for each element can be changed and offsets adjusted)
- In general use rectangles for each element and place it at its specified locations in real time. The user can setup an stl model for each element using prefabs. A prefab can be created in a separate 3d view and where you can adjust the offsets easily to reuse later. This model is then shown instead of the rectangle. The prefab view should also have the ability to add conveyors (as a going-through infinite rectangle, or as an edge with a starting point and the other side going through, also rectangular like)
- The actual interface must add extra 3d elements that would act as indicators to show in which direction a conveyor is moving etc. Be creative with those. As a background choose something generic with an infinite skadis-like plain on which all of those devices are mounted (in reality mounted, here it just looks like they are because of the offsets). Skadis are those board which have holes in them where you can hook something in there.
- Inside cargo there are containers which each are objects too. These can be basic cylinders (50ml, 10ml falcons), or circles on top of a rectangular box (tips container), or many cylindrical wholes in a rectangular box (well plate), etc. Keep in mind that one single container is one of those holes or tips and never a whole container, so you must make those basic shapes available including a collection of them. The user should have no difficulties creating those
The "game" theme is cyberpunk with arcane inspired elements which lead to a scientist lab-like feel in which there are accent colors clearly sticking out of the whole, more neutral picture

Features required:
- The cargo, if moving, should show its location in realtime with indicators showing what is moving in which direction
- A configuration file on the users side, must keep track of all models used for which id, its offsets, and other user configurations
- Create multiple different themes for both the interface, but also in the 3d world
- The user can take any cargo out of the system so it temporarily is not available and add another different cargo anytime
- The user can be informed through the manual instructions to do a task with which container, the 3d view should clearly notify the user as well as show for which container which task needs to be performed
- An indicator at the side somewhere should give basic specs about the future instructions and whether manual intervention will be needed
- The user can start any protocol and have a time estimate of how long it takes
- For now a move of distance x, takes 10x milliseconds in the beginning. Moves in x and y direction differ. Through the first few moves, adjust the speed prediction by measuring how much off the prediction is from the db changing into completed. In the interface try to smooth out any jumps either way
- There must be a protocol browser with game-like icons where you can choose and select any protocol you like to view, edit or run it
- Editing or creating a protocol should have little to no text syntax and should be visual. The user can see a whole list of which container from which cargo (shown with 3d models and indicators) together with its material with basic concentrations is used in each step to perform which instruction (indicated with icons again). The user can select any part, adjust the transfer amount, adjust which container, which cargo (either with different material, or quick select if multiple containers have the same material inside). So it should a fully implmented protocol creator and views in 3d, which reads and can write to the warehouse servers any modifications it made
- It should be "playable" also on mobile devices in which controls are restrictive
- Indicate hazards, if a container has any
- Create a running prototype that visually looks amazing, feels great, and uses the given (or little missing features which you indicated that you need) features at their best. User configurations are client sided settings to make the state be kept after reopening the website
