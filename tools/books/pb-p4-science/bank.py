# P4 Primary Science question bank (English). Run: python3 -I bank.py out.json
import json, sys, random, re
sys.path.insert(0, '/tmp/ps')
from figs_sci import circuits, earth_layers, shadows, flower

B = {}; cur = None; pos = [0]
def unit(u):
    global cur; cur = u; B[u] = []
def add(q): B[cur].append(q)
LET = 'ABCD'
def M(level, stem, correct, wrongs, expl, fig=None):
    assert len(wrongs) == 3 and correct not in wrongs and len(set(wrongs)) == 3, (stem, correct, wrongs)
    k = pos[0] % 4; pos[0] += 1
    rnd = random.Random(len(B[cur]) * 7 + len(stem)); w = list(wrongs); rnd.shuffle(w)
    opts = w[:k] + [correct] + w[k:]
    LBL = re.compile(r'^((Shape|Circuit|Layer) \d|[XYZ])$')
    if sum(1 for o in [correct] + list(wrongs) if LBL.match(str(o))) >= 3:
        # labels for a picture or table (Circuit 1-4, Shape 1-4, X/Y/Z): keep them in order, other choices last
        opts = sorted([o for o in [correct] + list(wrongs) if LBL.match(str(o))], key=str) + [o for o in wrongs if not LBL.match(str(o))]
        k = opts.index(correct)
    q = {'type': 'mcq', 'level': level, 'stem': stem, 'options': [str(o) for o in opts], 'correct_option': LET[k], 'explanation': expl, 'parts': []}
    if fig: q['figure'] = {'img': fig}
    add(q)
def S(level, stem, answer, expl, accept='', fig=None, prompt='Write your answer.'):
    """One-line answer."""
    q = {'type': 'short', 'level': level, 'stem': stem, 'parts': [{'label': '', 'prompt': prompt, 'marks': 1, 'mark_scheme': [f"Answer: {answer}" + (f". {accept}" if accept else '')], 'blank': True}], 'explanation': expl}
    if fig: q['figure'] = {'img': fig}
    add(q)
def E(level, stem, points, expl, fig=None, prompt='Write your answer in one or two sentences.'):
    """Explain question: one mark per point in the mark scheme."""
    q = {'type': 'short', 'level': level, 'stem': stem, 'parts': [{'label': '', 'prompt': prompt, 'marks': len(points), 'mark_scheme': points}], 'explanation': expl}
    if fig: q['figure'] = {'img': fig}
    add(q)
def P(level, stem, parts, expl, fig=None):
    """parts: [(label, prompt, answer, accept)], 1 mark each, one-line answers."""
    q = {'type': 'structured', 'level': level, 'stem': stem, 'parts': [{'label': l, 'prompt': p, 'marks': 1, 'mark_scheme': [f"Answer: {a}" + (f". {acc}" if acc else '')], 'blank': True} for l, p, a, acc in parts], 'explanation': expl}
    if fig: q['figure'] = {'img': fig}
    add(q)
TF = "Write T (true) or F (false)."

# ---------- Unit 1: Thinking like a scientist ----------
unit('u0')
FT = ("Ken wants to find out whether a toy car rolls further on carpet or on a wooden floor. He lets the car roll down a ramp onto each surface.")
M(1, FT + "\n\nWhat should Ken change in his test?", "the surface the car rolls onto", ["the height of the ramp", "the toy car", "how hard he pushes the car"], "In a fair test you change only one thing: here, the surface. Everything else stays the same.")
M(2, FT + "\n\nWhat should Ken measure?", "how far the car travels", ["the colour of the car", "the height of the ramp", "the weight of the carpet"], "The result Ken looks at is the distance the car travels, measured in cm.")
P(2, FT + "\n\nShould Ken keep each of these the same? Write yes or no.", [("(a)", "the same toy car", "yes", ""), ("(b)", "the same height of the ramp", "yes", ""), ("(c)", "the same surface", "no", "the surface is what he changes")], "Only the surface changes. The car and the ramp height must stay the same, or the test is not fair.")
M(2, "Why should a fair test be repeated a few times?", "to make sure one result was not a mistake", ["to make the test take longer", "to change more things each time", "because the first result is always wrong"], "Repeating a test and comparing results shows whether the results are reliable. One result on its own could be a mistake.")
M(1, "Which is the FIRST step of the design cycle?", "Find the need or the problem.", ["Make the model.", "Test and improve the model.", "Tell others about the solution."], "Engineers start by finding out what problem needs to be solved. Then they collect information, plan, sketch, make, test and improve, and share.")
M(2, "Long ago, many people believed the Sun moves around the Earth. Today we know the Earth moves around the Sun. What does this show?", "Scientific ideas can change when there is new evidence.", ["Scientists never make mistakes.", "Old ideas are always right.", "Science never changes."], "New observations and measurements gave new evidence, so scientists changed their ideas.")
E(3, "Mei tested two paper towels. She poured 100 mL of water on Towel A and 50 mL of water on Towel B. Towel A soaked up more water, so she said Towel A is better.\n\nIs her test fair? Explain.", ["No, it is not a fair test (1 mark).", "She used different amounts of water, so she changed two things at once / the amount of water should be the same (1 mark)."], "Only the towel should change. She also changed the amount of water, so we cannot tell which one caused the difference.")
S(2, "Fill in the blank.\n\nIn a fair test, we change only ______ thing.", "one", "If more than one thing changes, we cannot tell which one caused the result.", accept="Accept 'one' or '1'")

# ---------- Unit 2: Communicable diseases ----------
unit('u1')
M(1, "Which of these is a communicable disease?", "influenza", ["heart disease", "diabetes", "cancer"], "Influenza (flu) is caused by a virus and can spread from person to person. The others are non-communicable.")
M(1, "What causes communicable diseases?", "germs such as viruses and bacteria", ["eating too much sugar", "not sleeping enough", "growing too fast"], "Communicable diseases are caused by germs, which can pass from one person to another.")
M(2, "Dengue fever is spread by …", "mosquitoes", ["shaking hands", "drinking boiled water", "sharing books"], "Dengue fever is spread by mosquitoes. An animal that carries germs is called a vector.")
P(2, "How does each disease mainly spread? Choose from: droplets, food and water, mosquitoes, blood.", [("(a)", "cholera", "food and water", ""), ("(b)", "influenza", "droplets", ""), ("(c)", "hepatitis B", "blood", ""), ("(d)", "dengue fever", "mosquitoes", "")], "Cholera germs are in dirty food and water. Flu spreads through droplets from coughs and sneezes. Hepatitis B spreads through blood. Dengue is carried by mosquitoes.")
M(2, "Which is the best way to stop mosquitoes from breeding?", "Empty water from flower pots and cans.", ["Keep windows open at night.", "Leave rubbish bins uncovered.", "Water the plants more often."], "Mosquitoes lay eggs in still water. Removing standing water stops them breeding.")
M(2, "How long should you wash your hands with liquid soap?", "at least 20 seconds", ["about 2 seconds", "only after meals", "only when they look dirty"], "Rub hands with soap for at least 20 seconds, then rinse. Germs can be on hands even when they look clean.")
E(2, "Sam has the flu. Give TWO things he should do to stop the flu spreading to his classmates.", ["Any one of: stay at home and rest / wear a mask / cover his mouth and nose when coughing or sneezing / wash his hands often / see a doctor (1 mark).", "A second, different point from the list (1 mark)."], "Flu spreads by droplets and contact, so staying away from others, covering coughs, masks and handwashing all help.")
M(3, "How do vaccines help us?", "They help the body learn to fight a germ.", ["They kill all germs in the air.", "They make food safe to eat.", "They stop mosquitoes biting."], "A vaccine trains the body's defences to recognise a germ, so the body can fight it quickly if it gets in.")

# ---------- Unit 3: Non-communicable diseases ----------
unit('u2')
M(1, "Which of these is a non-communicable disease?", "diabetes", ["chickenpox", "influenza", "cholera"], "Diabetes is not caused by germs and cannot spread from person to person.")
M(1, "Can you catch heart disease from a friend?", "No, because it is not caused by germs.", ["Yes, by shaking hands.", "Yes, through droplets.", "Yes, by sharing food."], "Heart disease is non-communicable. It is linked to diet, exercise, smoking and family history, not germs.")
P(2, TF, [("(a)", "Smoking increases the risk of heart disease and cancer.", "T", ""), ("(b)", "Eating lots of salty and fried food is good for the heart.", "F", ""), ("(c)", "Regular exercise helps prevent non-communicable diseases.", "T", ""), ("(d)", "Only old people need to think about healthy habits.", "F", "")], "Smoking and unhealthy food raise the risk. Exercise lowers it. Healthy habits matter at every age.")
M(2, "Which snack is the healthiest choice?", "an apple", ["a bag of potato chips", "a can of cola", "a chocolate bar"], "Fruit has little fat, salt or added sugar. The others are high in fat, salt or sugar.")
M(2, "Which disease is linked to too much sugar in the blood?", "diabetes", ["cancer", "influenza", "dengue fever"], "In diabetes, there is too much sugar in the blood. Signs include being very thirsty and going to the toilet often.")
E(2, "Give TWO habits that can lower the risk of heart disease.", ["Any one of: eat a balanced diet with less fat, salt and sugar / exercise regularly / do not smoke / keep a healthy weight / have regular health checks (1 mark).", "A second, different habit (1 mark)."], "Heart disease is linked to unhealthy food, little exercise, smoking and being overweight, so changing these habits lowers the risk.")
P(3, "Write C for communicable or N for non-communicable.", [("(a)", "cancer", "N", ""), ("(b)", "chickenpox", "C", ""), ("(c)", "high blood pressure", "N", ""), ("(d)", "cholera", "C", "")], "Diseases caused by germs (chickenpox, cholera) are communicable. Cancer and high blood pressure are not caused by germs.")

# ---------- Unit 4: Inside the Earth ----------
unit('u3')
FE = earth_layers()
P(1, "Look at the picture. Name the layers.", [("(a)", "Layer 1", "crust", ""), ("(b)", "Layer 2", "mantle", ""), ("(c)", "Layer 3", "core", "")], "From the outside in: the crust (thin outer layer), the mantle (thick, hot layer) and the core (hot metal centre).", fig=FE)
M(1, "Look at the picture. Which layer is the hottest?", "Layer 3", ["Layer 1", "Layer 2", "All the layers are the same temperature."], "The core (Layer 3) is at the centre and is the hottest part of the Earth. The deeper you go, the hotter it gets.", fig=FE)
M(2, "Which layer of the Earth is the thinnest?", "the crust", ["the mantle", "the core", "They are all the same thickness."], "The crust is the thinnest layer. The mantle is the thickest.")
M(2, "The Earth's core is made mostly of …", "iron and nickel", ["water and ice", "sand and clay", "plastic and glass"], "The core is made mostly of the metals iron and nickel.")
M(2, "Granite forms when hot melted rock cools and becomes solid. What kind of rock is granite?", "igneous rock", ["sedimentary rock", "metamorphic rock", "soil"], "Rock formed from cooled melted rock (magma) is igneous rock.")
M(2, "Which rock is formed from layers of sand or mud pressed together over a long time?", "sandstone", ["granite", "marble", "basalt"], "Sandstone is a sedimentary rock. It forms from layers of sand pressed together.")
P(3, "Write the type of rock: igneous, sedimentary or metamorphic.", [("(a)", "marble", "metamorphic", "formed from limestone by heat and pressure"), ("(b)", "basalt", "igneous", ""), ("(c)", "shale", "sedimentary", "")], "Marble is limestone changed by heat and pressure. Basalt forms from cooled lava. Shale forms from layers of mud.")
E(3, "A rock has clear layers and a shell fossil inside it. What kind of rock is it most likely to be? Explain.", ["Sedimentary rock (1 mark).", "It formed from layers (of sand or mud) settling under water, where shells could be buried (1 mark)."], "Sedimentary rocks form in layers, often under water, so they can trap shells and other remains as fossils.")

# ---------- Unit 5: Soil ----------
unit('u4')
M(1, "Which of these is NOT part of soil?", "plastic", ["tiny pieces of rock", "humus", "air"], "Soil is made of rock pieces, humus, water, air and living things. Plastic is rubbish, not a natural part of soil.")
M(1, "What is humus?", "rotted dead plants and animals in the soil", ["a kind of rock", "a kind of insect", "the water in soil"], "Humus is decayed plant and animal material. It gives soil nutrients and a dark colour.")
P(2, "Which soil is described? Write sandy soil, clay soil or loam.", [("(a)", "Rough, with big grains. Water drains through very quickly.", "sandy soil", ""), ("(b)", "Smooth and sticky when wet. Holds a lot of water.", "clay soil", ""), ("(c)", "Dark and crumbly, rich in humus. Good for most plants.", "loam", "")], "Sandy soil drains fast; clay soil holds water; loam is a rich mixture that suits most plants.")
M(2, "Which plant grows best in sandy soil?", "cactus", ["lotus", "rice", "water lily"], "Sandy soil is dry because water drains quickly. A cactus needs little water.")
M(2, "Which soil is best for growing most vegetables?", "loam", ["sandy soil", "clay soil", "pebbles"], "Loam drains well but holds enough water, air and nutrients, so most vegetables grow well in it.")
TBL = "Tom poured 100 mL of water through the same amount of three soils for 5 minutes.\n\n| Soil | Water that drained through (mL) |\n|---|---|\n| X | 80 |\n| Y | 25 |\n| Z | 55 |"
M(2, TBL + "\n\nWhich soil is most likely to be sandy soil?", "X", ["Y", "Z", "We cannot tell."], "Sandy soil has big spaces, so most water drains through it quickly: soil X (80 mL).")
M(3, TBL + "\n\nWhich soil is most likely to be clay soil?", "Y", ["X", "Z", "We cannot tell."], "Clay holds water, so the least water drains through it: soil Y (25 mL).")
E(3, TBL + "\n\nName TWO things Tom kept the same to make this a fair test.", ["Any one of: the amount of soil / the amount of water (100 mL) / the time (5 minutes) / the same funnels or filter paper (1 mark).", "A second, different factor (1 mark)."], "Only the type of soil was changed. The amount of soil, the amount of water and the time stayed the same.")

# ---------- Unit 6: Energy ----------
unit('u5')
M(1, "Which of these is a renewable source of energy?", "wind", ["coal", "crude oil", "natural gas"], "Wind will not run out, so it is renewable. Coal, oil and gas are fossil fuels and will run out.")
M(1, "Coal, crude oil and natural gas are called …", "fossil fuels", ["renewable energy", "solar energy", "electricity"], "They formed from living things that died millions of years ago, so they are fossil fuels.")
P(2, "Write R for renewable or N for non-renewable.", [("(a)", "sunlight", "R", ""), ("(b)", "natural gas", "N", ""), ("(c)", "moving water", "R", ""), ("(d)", "coal", "N", "")], "Sunlight and moving water will not run out. Natural gas and coal will run out one day.")
M(2, "Which sentence is correct?", "Electricity can be made from sources such as coal, wind or sunlight.", ["Electricity is a natural source of energy found underground.", "Solar panels make electricity from wind.", "Fossil fuels will never run out."], "Electricity is made from other sources of energy. Solar panels use sunlight.")
M(2, "Which of these does NOT help to save energy?", "leaving the TV on standby all night", ["switching off lights when leaving a room", "setting the air conditioner to 25.5°C", "walking instead of taking a car for short trips"], "Appliances on standby still use electricity. The other choices all save energy.")
E(2, "Give TWO reasons why we should save energy.", ["Any one of: fossil fuels will run out / less pollution / less global warming (less carbon dioxide) / saves money (1 mark).", "A second, different reason (1 mark)."], "Saving energy means burning fewer fossil fuels, which run out and cause pollution and global warming. It also saves money.")
M(3, "Why does Hong Kong NOT make much electricity from moving water?", "It has no big rivers or high waterfalls.", ["Water cannot make electricity.", "It rains too little in Hong Kong.", "Moving water is a fossil fuel."], "Hydroelectric power needs a lot of fast-flowing or falling water, such as a big river or dam.")
M(2, "In which of these do we use energy for transport?", "riding the MTR", ["reading a library book in daylight", "sleeping", "planting a tree"], "Trains, buses, cars and planes all need energy to move people and goods.")

# ---------- Unit 7: Day and night, seasons ----------
unit('u6')
M(1, "What causes day and night?", "the Earth spinning on its axis", ["the Sun moving around the Earth", "the Moon blocking the Sun", "clouds covering the Sun"], "The Earth rotates once about every 24 hours. The half facing the Sun has day; the other half has night.")
M(1, "How long does the Earth take to spin around once?", "about 24 hours", ["about 1 hour", "about 1 month", "about 1 year"], "One rotation takes about 24 hours: one day.")
M(1, "How long does the Earth take to travel once around the Sun?", "about 1 year", ["about 24 hours", "about 1 week", "about 1 month"], "One revolution around the Sun takes about 365 days: one year.")
P(2, "Fill in the blanks with 'rotation' or 'revolution'.", [("(a)", "The Earth spinning on its axis is called ______.", "rotation", ""), ("(b)", "The Earth moving around the Sun is called ______.", "revolution", "")], "Rotation = spinning (1 day). Revolution = going around the Sun (1 year).")
M(2, "Why does the Sun seem to rise in the east?", "because the Earth spins from west to east", ["because the Sun moves from east to west", "because the Earth spins from east to west", "because the Moon pushes the Sun"], "As the Earth turns from west to east, places in the east see the Sun first, so the Sun appears to rise in the east.")
M(2, "In July, it is summer in Hong Kong. What season is it in Australia?", "winter", ["summer", "spring", "It has no seasons."], "Hong Kong is in the northern hemisphere and Australia is in the southern hemisphere, so their seasons are opposite.")
E(3, "Explain why it is summer in Hong Kong when it is winter in Australia.", ["The Earth's axis is tilted (1 mark).", "In June/July the northern hemisphere (Hong Kong) leans towards the Sun and gets stronger sunlight, while the southern hemisphere (Australia) leans away (1 mark)."], "Because of the tilted axis, the two hemispheres take turns leaning towards the Sun as the Earth goes around it.")
M(3, "Which is NOT a reason for the seasons?", "The Earth is much closer to the Sun in summer.", ["The Earth's axis is tilted.", "The Earth revolves around the Sun.", "The Sun is higher in the sky in summer."], "Seasons are caused by the tilted axis as the Earth revolves around the Sun, not by distance. Otherwise both hemispheres would have summer at the same time.")

# ---------- Unit 8: Weather, climate, global warming ----------
unit('u7')
P(1, "Write W for weather or C for climate.", [("(a)", "It is very windy this afternoon.", "W", ""), ("(b)", "Hong Kong usually has hot, rainy summers.", "C", ""), ("(c)", "It will rain tomorrow.", "W", ""), ("(d)", "Deserts get very little rain every year.", "C", "")], "Weather is about a certain time (today, tomorrow). Climate is the usual pattern over many years.")
M(1, "What does 'humidity' tell us?", "how much water vapour is in the air", ["how fast the wind is blowing", "how much sunlight there is", "how high the sea is"], "High humidity means a lot of water vapour in the air, so it feels sticky.")
M(2, "Which place is very cold all year, with ice and snow?", "Antarctica", ["the Sahara Desert", "the Amazon rainforest", "Hong Kong"], "Antarctica is a polar region. It is very cold all year.")
M(2, "What is the main cause of global warming?", "burning fossil fuels, which releases greenhouse gases", ["the Earth moving closer to the Sun", "too many clouds", "using too much water"], "Burning coal, oil and gas releases carbon dioxide and other greenhouse gases, which trap heat around the Earth.")
M(2, "Which of these is an impact of global warming?", "Sea levels rise.", ["Glaciers grow bigger.", "Winters get much colder everywhere.", "There are fewer hot days."], "As the Earth warms, glaciers and polar ice melt, so the sea level rises.")
E(2, "Give TWO things you can do to help slow down global warming.", ["Any one of: save electricity / switch off lights and appliances / use public transport, walk or cycle / reduce, reuse, recycle / plant trees / use renewable energy / waste less food (1 mark).", "A second, different action (1 mark)."], "Using less energy and fewer fossil fuels means fewer greenhouse gases.")
M(3, "Why can melting glaciers be a danger to people living near the coast?", "The sea level rises and low land may flood.", ["The water becomes too salty to swim in.", "It makes the air too dry.", "It causes earthquakes."], "Melting ice on land adds water to the sea, so the sea level rises and low coastal areas can flood.")
M(2, "Polar bears hunt from sea ice. How does global warming affect them?", "They lose the sea ice they hunt on.", ["They get more food.", "Their fur becomes thicker.", "They move to the desert."], "Warmer temperatures melt the sea ice, so polar bears find it harder to hunt.")

# ---------- Unit 9: Adaptations ----------
unit('u8')
M(1, "How do the spines of a cactus help it live in the desert?", "They lose little water and stop animals eating it.", ["They make food from sunlight.", "They help it float.", "They keep it warm."], "Cactus spines are thin leaves. They lose very little water, and they protect the plant from animals.")
M(1, "Which feature helps a polar bear keep warm?", "thick fur and a layer of fat", ["a long neck", "webbed feet", "big ears"], "Thick fur and fat keep the body heat in, in the freezing Arctic.")
P(2, "Match each feature to how it helps. Write the letter.\n\nA. stores fat for when food is scarce\nB. keeps sand out of its eyes\nC. stops it sinking into the sand", [("(a)", "a camel's long eyelashes", "B", ""), ("(b)", "a camel's hump", "A", ""), ("(c)", "a camel's wide feet", "C", "")], "Long eyelashes keep out sand, the hump stores fat, and wide feet spread the camel's weight on soft sand.")
M(2, "Why do lotus plants have large, flat leaves?", "to float on water and catch sunlight", ["to store water in the desert", "to keep away insects", "to grip the rocks"], "The big flat leaves float on the pond surface where they get plenty of light.")
M(2, "Black-faced spoonbills fly to Mai Po for the winter. What is this behaviour called?", "migration", ["hibernation", "camouflage", "pollination"], "Moving to another place for part of the year is migration.")
M(2, "Some frogs and snakes sleep deeply through the winter. What is this called?", "hibernation", ["migration", "reflection", "competition"], "Hibernation is a deep sleep during winter, when food is hard to find. It saves energy.")
E(3, "Explain how a stick insect's shape helps it survive.", ["It looks like a stick / twig, so it is hard to see (camouflage) (1 mark).", "Predators cannot find it easily, so it is less likely to be eaten (1 mark)."], "Camouflage helps animals hide from predators (or from prey).")
M(3, "Mangroves grow in soft, salty mud at the seashore. Which feature helps them?", "Some roots stick up out of the mud to take in air.", ["They have spines instead of leaves.", "They grow underground.", "They have thick fur."], "The mud has little air, so some mangrove roots grow upwards to take in air. Prop roots also hold them firm.")

# ---------- Unit 10: Habitats and food chains ----------
unit('u9')
CH = "Look at this food chain:\n\ngrass → grasshopper → frog → snake → eagle"
M(1, CH + "\n\nWhich living thing is the producer?", "grass", ["grasshopper", "frog", "eagle"], "The producer is the green plant that makes its own food using sunlight. Food chains always start with a producer.")
M(1, CH + "\n\nWhat does the arrow '→' mean?", "is eaten by", ["eats", "is bigger than", "lives with"], "The arrow shows the direction the food goes: grass is eaten by the grasshopper.")
M(2, CH + "\n\nWhich animal is both a predator and prey?", "frog", ["grass", "eagle", "grasshopper"], "The frog eats grasshoppers (predator) and is eaten by snakes (prey). The snake is also both.")
E(3, CH + "\n\nWhat would happen to the number of grasshoppers if all the frogs died? Explain.", ["The number of grasshoppers would increase (1 mark).", "Because nothing (fewer animals) would eat them (1 mark)."], "Frogs eat grasshoppers. Without frogs, more grasshoppers survive. They may then eat too much grass.")
S(2, "Put these living things in order to make a food chain: snake, rice plant, eagle, rat.", "rice plant → rat → snake → eagle", "Start with the producer (rice plant). The rat eats the rice, the snake eats the rat, and the eagle eats the snake.", accept="Arrows must point towards the eater")
M(2, "Which animal lives in a polar region?", "penguin", ["camel", "zebra", "orangutan"], "Penguins live in Antarctica. Camels live in deserts, zebras on the savanna, orangutans in rainforests.")
M(2, "Tall trees in a forest block the light from small plants below them. This is an example of …", "competition for light", ["a food chain", "migration", "pollination"], "Living things compete for things in short supply, such as light, food, water and space.")
M(3, "Lions and hyenas both hunt zebras. What is the relationship between the lions and the hyenas?", "They compete for food.", ["They are predator and prey.", "The lions are producers.", "They help each other catch food."], "Both want the same food (zebras), so they compete with each other.")

# ---------- Unit 11: How plants reproduce ----------
unit('u10')
FF = flower()
P(1, "Look at the flower. Name the parts.", [("(a)", "P (the top of the female part)", "pistil (stigma)", "accept pistil or stigma"), ("(b)", "Q", "stamen", "accept anther"), ("(c)", "R (it becomes the fruit)", "ovary", "")], "Q is the stamen, which makes pollen. P is the top of the pistil, where pollen lands. R is the ovary, which grows into the fruit.", fig=FF)
M(1, "What is pollination?", "moving pollen from a stamen to a pistil", ["a seed starting to grow", "a fruit falling off a tree", "a plant making food"], "Pollination is the moving of pollen, often by insects or the wind.")
M(2, "After fertilisation, which part of the flower grows into the fruit?", "the ovary", ["the petals", "the stamen", "the leaves"], "The ovary grows into the fruit, and the ovules inside it grow into seeds.")
M(2, "Flowers pollinated by insects are usually …", "colourful and sweet-smelling", ["small and dull", "covered in sharp spines", "without petals"], "Bright colours, scent and nectar attract insects, which carry pollen between flowers.")
P(2, "How are these seeds mainly spread? Choose from: wind, animals, water, bursting.", [("(a)", "dandelion (light, fluffy seeds)", "wind", ""), ("(b)", "coconut (a fruit that floats)", "water", ""), ("(c)", "berries eaten by birds", "animals", ""), ("(d)", "pea pods that dry and pop open", "bursting", "")], "Light seeds blow in the wind; floating fruits travel by water; animals eat fruits and drop the seeds; some pods burst open.")
M(2, "The potato we eat can grow into a new potato plant. Which part of the plant is it?", "a stem", ["a root", "a leaf", "a seed"], "A potato is an underground stem. Its 'eyes' grow into new shoots.")
E(3, "Why is it important for seeds to be spread away from the parent plant?", ["So the young plants are not too crowded / do not compete with the parent (1 mark).", "So they get enough light, water, space or nutrients to grow (1 mark)."], "If all the seeds fell under the parent plant, the young plants would compete with it and with each other.")
M(3, "A fish lays thousands of eggs at a time. Why?", "Many eggs are eaten, so laying lots means some young can survive.", ["Fish cannot count their eggs.", "Each egg needs a lot of care.", "Fish eggs are very large."], "Making many eggs or seeds increases the chance that some offspring survive.")

# ---------- Unit 12: Inheritance ----------
unit('u11')
M(1, "What does 'inherit' mean?", "get a characteristic from your parents", ["learn a new skill", "grow taller with exercise", "move to a new home"], "Inherited characteristics are passed from parents to their offspring.")
P(2, "Write I for inherited or N for not inherited.", [("(a)", "natural eye colour", "I", ""), ("(b)", "being able to swim", "N", "a learned skill"), ("(c)", "speaking Cantonese", "N", "learned"), ("(d)", "being able to roll your tongue", "I", ""), ("(e)", "a scar on your knee", "N", "")], "Eye colour and tongue rolling are passed on from parents. Swimming, languages and scars come from what we do or what happens to us.")
M(2, "Ann's mother is an excellent pianist. Will Ann be able to play the piano without learning?", "No, playing the piano is a skill that must be learned.", ["Yes, she will inherit the skill.", "Yes, if she eats well.", "Only if her father also plays."], "Skills are not inherited. Ann has to learn and practise.")
M(2, "Kittens usually look like their parents because …", "they inherit characteristics from their parents", ["they copy their parents", "they eat the same food", "they live in the same house"], "Offspring inherit characteristics, such as fur colour and pattern, from their parents.")
M(2, "Which characteristic can NOT be changed by practising?", "whether you can bend your thumb back a lot", ["how fast you can run", "how well you can draw", "how many English words you know"], "Being able to bend the thumb backwards is inherited. The others improve with practice.")
E(3, "Twin brothers have the same eye colour, but one speaks French and the other does not. Explain why.", ["Eye colour is inherited (from their parents) (1 mark).", "Speaking a language is learned, not inherited (1 mark)."], "Inherited characteristics come from parents; learned characteristics depend on what each person does.")
M(3, "Are brothers and sisters exactly the same?", "No, each child gets a different mix of characteristics from both parents.", ["Yes, they always look the same.", "No, they only get characteristics from their mother.", "Yes, if they eat the same food."], "Each child inherits a different mix from the mother and father, so siblings look alike but not the same (except identical twins).")

# ---------- Unit 13: Friction ----------
unit('u12')
M(1, "What is friction?", "a force that tries to stop surfaces sliding over each other", ["a kind of energy from the Sun", "the weight of an object", "a magnet's pull"], "Friction happens when surfaces rub together. It slows things down.")
M(1, "A box is pushed to the right across the floor. In which direction does friction act on the box?", "to the left", ["to the right", "upwards", "downwards"], "Friction always acts in the opposite direction to the movement.")
M(2, "On which surface is it easiest to slip?", "a wet, polished floor", ["a dry rubber mat", "a carpet", "a rough concrete path"], "Smooth and wet surfaces have little friction, so it is easy to slip.")
P(2, "Does each one INCREASE or REDUCE friction? Write increase or reduce.", [("(a)", "putting oil on a bicycle chain", "reduce", ""), ("(b)", "patterns (tread) on shoe soles", "increase", ""), ("(c)", "spreading sand on an icy path", "increase", ""), ("(d)", "using wheels to move a heavy box", "reduce", "")], "Oil and wheels make movement easier (less friction). Tread and sand make surfaces grip (more friction).")
M(2, "Why can we write with a pencil on paper but not well on glass?", "There is more friction between the pencil and paper.", ["Paper is heavier than glass.", "Glass is too hot.", "Pencils only work on white things."], "Rough paper rubs the pencil lead off, leaving a mark. Smooth glass gives too little friction.")
E(3, "Why do cars take longer to stop on a rainy day? Explain using friction.", ["The water reduces the friction between the tyres and the road (1 mark).", "So the car slides more / brakes grip less, and it takes a longer distance to stop (1 mark)."], "Water makes the road surface slippery, so there is less friction to slow the car down.")
FTR = "A toy car was let go from the same height on the same ramp onto three surfaces.\n\n| Surface | Distance travelled (cm) |\n|---|---|\n| carpet | 35 |\n| wood | 120 |\n| tiles | 160 |"
M(2, FTR + "\n\nWhich surface had the most friction?", "carpet", ["wood", "tiles", "They all had the same friction."], "More friction slows the car down more, so it travels the shortest distance: carpet (35 cm).")
M(3, FTR + "\n\nWhat is the factor that was changed in this test?", "the surface", ["the distance travelled", "the height of the ramp", "the toy car"], "Only the surface was changed. The distance travelled was measured. The car, ramp and height were kept the same.")

# ---------- Unit 14: Light ----------
unit('u13')
P(1, "Is it a light source? Write yes or no.", [("(a)", "the Sun", "yes", ""), ("(b)", "the Moon", "no", "it reflects sunlight"), ("(c)", "a lit candle", "yes", ""), ("(d)", "a mirror", "no", "it reflects light")], "A light source gives out its own light. The Moon and mirrors only reflect light.")
M(1, "Why can we see the Moon at night?", "It reflects light from the Sun.", ["It makes its own light.", "It is on fire.", "It reflects light from the Earth's cities."], "The Moon has no light of its own. Sunlight bounces off it to our eyes.")
M(2, "Which of these is an example of reflection?", "seeing the trees upside down in a still pond", ["a torch shining in the dark", "a candle burning", "a firefly glowing"], "A still water surface reflects light like a mirror. The others are light sources.")
M(2, "How does a shadow form?", "An object blocks the light.", ["Light bends around an object.", "An object gives out dark light.", "The Sun is behind a cloud."], "Light travels in straight lines. An opaque object stops it, leaving a dark area behind.")
FS = shadows()
M(2, "Look at the picture. Which shadow was made at about 8 o'clock in the morning?", "X", ["Y", "Z", "All of them"], "In the morning the Sun is low in the east, so the shadow is long and points to the west: shadow X.", fig=FS)
M(2, "Look at the picture. Which shadow was made around noon?", "Y", ["X", "Z", "None of them"], "Around noon the Sun is high in the sky, so the shadow is shortest: shadow Y.", fig=FS)
E(3, "Look at the picture. Shadow Z points to the east. Where was the Sun, and at what time of day was the shadow made? Explain.", ["The Sun was low in the west / the shadow was made in the late afternoon or evening (1 mark).", "A shadow is on the opposite side of the object from the Sun (1 mark)."], "Shadows point away from the light source. A long shadow pointing east means the Sun was low in the west, in the late afternoon.", fig=FS)
M(3, "Why are shadows longer in the morning than at noon?", "The Sun is lower in the sky in the morning.", ["The Sun is bigger in the morning.", "The air is colder in the morning.", "Objects grow taller at night."], "The lower the light source, the longer the shadow.")

# ---------- Unit 15: Circuits ----------
unit('u14')
FC = circuits()
M(1, "Look at the four circuits. In which one will the bulb light up?", "Circuit 1", ["Circuit 2", "Circuit 3", "Circuit 4"], "Only Circuit 1 is a complete loop from one end of the battery, through the bulb, back to the other end.", fig=FC)
P(2, "Look at the four circuits. Why does the bulb NOT light up? Match each circuit to a reason.\n\nA. The switch is open.\nB. There is a gap in a wire.\nC. Both wires are joined to the same end of the battery.", [("(a)", "Circuit 2", "B", ""), ("(b)", "Circuit 3", "C", ""), ("(c)", "Circuit 4", "A", "")], "A bulb lights up only in a complete (closed) circuit. A gap, an open switch, or both wires on one battery end break the loop.", fig=FC)
M(1, "What is a closed circuit?", "a complete loop with no gaps", ["a circuit with the switch open", "a circuit with no battery", "a circuit inside a box"], "Electricity can flow only around a complete loop. That is a closed circuit.")
M(2, "What does a switch do in a circuit?", "It opens or closes the gap in the circuit.", ["It gives electricity to the circuit.", "It makes the bulb brighter.", "It stores electricity."], "When the switch is on (closed), the circuit is complete. When it is off (open), there is a gap.")
M(2, "Why are electric wires covered in plastic?", "Plastic does not let electricity pass through, so it keeps us safe.", ["Plastic makes the electricity flow faster.", "Plastic is a good conductor.", "Plastic makes the wire heavier."], "Plastic is an insulator. It stops electricity from reaching our hands.")
M(2, "Which of these is SAFE?", "using batteries for a classroom circuit experiment", ["touching a plug with wet hands", "putting a key into a wall socket", "plugging many appliances into one socket"], "Small batteries are safe for experiments. Mains electricity from wall sockets is very dangerous.")
E(3, "A torch does not light up even when it is switched on. Give TWO possible reasons.", ["Any one of: the battery is flat / the bulb is broken / the battery is put in the wrong way / a wire or contact is loose or broken (a gap in the circuit) (1 mark).", "A second, different reason (1 mark)."], "A torch only works when its circuit is complete and its parts are working.")

# ---------- Unit 16: Conductors and insulators ----------
unit('u15')
M(1, "Which material is a good conductor of electricity?", "copper", ["plastic", "rubber", "wood"], "Metals such as copper let electricity pass through easily.")
P(2, "Write C for conductor or I for insulator of electricity.", [("(a)", "a steel paper clip", "C", ""), ("(b)", "a plastic ruler", "I", ""), ("(c)", "an aluminium can", "C", ""), ("(d)", "a rubber band", "I", "")], "Metals (steel, aluminium) are conductors. Plastic and rubber are insulators.")
M(2, "Why are cooking pots usually made of metal?", "Metal is a good conductor of heat, so food cooks quickly.", ["Metal is a good insulator of heat.", "Metal is soft and light.", "Metal keeps food cold."], "Metal lets heat pass quickly from the stove to the food.")
M(2, "Why do frying pans have plastic or wooden handles?", "Plastic and wood are poor conductors of heat, so the handle does not get too hot to hold.", ["They are good conductors of heat.", "They make the pan cook faster.", "They are shinier than metal."], "Insulating handles stop heat reaching our hands.")
M(2, "Which property of copper makes it good for electric wires?", "It conducts electricity well.", ["It is shiny.", "It is heavy.", "It is a good heat insulator."], "Copper is an excellent conductor of electricity, and it can be pulled into thin wires.")
M(2, "Which material would be best for a cool box to keep drinks cold?", "foam", ["aluminium", "copper", "steel"], "Foam is a good heat insulator. It slows down heat moving into the box, so the drinks stay cold.")
E(3, "Explain why a woollen jumper keeps us warm in winter.", ["Wool is a poor conductor of heat / a heat insulator (it traps air) (1 mark).", "It slows down the heat leaving our body (it does not make heat) (1 mark)."], "Insulators slow down heat moving through them, so our body heat stays in.")
M(3, "A cup of hot water is wrapped in wool. Another cup of ice is also wrapped in wool. What happens?", "Both change temperature more slowly than unwrapped cups.", ["The hot water cools faster.", "The ice melts faster.", "The wool makes both cups hot."], "Insulators slow down heat moving in both directions: hot things stay hot longer and cold things stay cold longer.")

# ---------- Unit 17: Physical and chemical changes ----------
unit('u16')
P(2, "Write P for physical change or C for chemical change.", [("(a)", "ice melting", "P", ""), ("(b)", "a nail rusting", "C", ""), ("(c)", "sugar dissolving in water", "P", ""), ("(d)", "paper burning", "C", ""), ("(e)", "bread going mouldy", "C", "")], "Physical changes make no new substance (melting, dissolving). Chemical changes make new substances (rust, ash and smoke, mould).")
M(1, "In a chemical change …", "a new substance is made", ["only the shape changes", "nothing changes", "only the size changes"], "A chemical change makes a new substance, such as rust or ash.")
M(2, "Which of these is a physical change?", "stretching a rubber band", ["frying an egg", "burning wood", "an apple slice turning brown"], "Stretching changes only the shape. The others make new substances.")
M(2, "Which is a sign that a chemical change may have happened?", "a new smell and a change of colour", ["the object is cut into two pieces", "the object becomes wet", "the object is folded"], "New smells, colour changes, bubbles of gas, heat or light are signs of a chemical change.")
M(2, "Salt dissolves in water. Is the salt still there?", "Yes. If the water evaporates, the salt is left behind.", ["No, it has disappeared.", "No, it has turned into water.", "No, it has turned into sugar."], "Dissolving is a physical change. The salt is still in the water: you can taste it.")
E(3, "Iron gates near the sea in Hong Kong are often painted. Explain why.", ["Paint stops water and air from reaching the iron (1 mark).", "So the iron does not rust (as quickly) (1 mark)."], "Rusting needs water and air. Salty sea air makes iron rust faster, so painting it protects it.")
M(3, "A candle is lit. Which statement is correct?", "The wax melting is a physical change, and the wax burning is a chemical change.", ["Both the melting and the burning are physical changes.", "Both the melting and the burning are chemical changes.", "Nothing changes in a candle."], "Melting wax can harden again (physical). Burning makes new substances such as smoke and gives out heat and light (chemical).")
M(2, "Which of these can be easily changed back?", "water that has frozen into ice", ["toast", "ash from burnt paper", "a cooked egg"], "Ice can melt back into water. The others are chemical changes that cannot easily be reversed.")

# ---------- Unit 18: Space technology ----------
unit('u17')
M(1, "Which of these is an artificial satellite?", "a weather satellite", ["the Moon", "the Sun", "a star"], "Artificial satellites are made by people. The Moon is a natural satellite.")
P(2, "What kind of satellite is used for each job? Choose from: weather, navigation, communication.", [("(a)", "showing where your phone is on a map", "navigation", ""), ("(b)", "taking pictures of a typhoon", "weather", ""), ("(c)", "sending TV programmes around the world", "communication", "")], "Navigation satellites (e.g. BeiDou, GPS) find positions. Weather satellites watch clouds and storms. Communication satellites carry TV, phone and internet signals.")
M(2, "Who was the first Chinese astronaut to travel into space, in 2003?", "Yang Liwei", ["Zhai Zhigang", "Wang Yaping", "Isaac Newton"], "Yang Liwei flew on Shenzhou-5 in 2003. Zhai Zhigang did China's first spacewalk in 2008.")
M(2, "What is the name of China's space station?", "Tiangong", ["Shenzhou", "BeiDou", "Fengyun"], "Tiangong (天宮) is China's space station. Shenzhou is the spacecraft, BeiDou the navigation system and Fengyun the weather satellites.")
M(2, "Which everyday product came from space technology?", "memory foam pillows", ["wooden chopsticks", "paper books", "cotton T-shirts"], "Memory foam was first developed for seats in aircraft and spacecraft.")
M(2, "Why do astronauts sleep in sleeping bags fixed to the wall?", "So they do not float around while sleeping.", ["Because the space station is very hot.", "Because there are no beds on Earth.", "To keep away insects."], "Everything floats in the space station, so astronauts strap themselves in to sleep.")
E(3, "Why do astronauts need to exercise for about two hours every day in space?", ["Their muscles and bones get weaker in space (1 mark).", "Exercise keeps their muscles and bones strong (for when they return to Earth) (1 mark)."], "In space the body does not have to support its weight, so muscles and bones weaken unless astronauts exercise.")
M(3, "Old satellites and broken pieces left in space are a problem because …", "they can crash into other satellites", ["they make the weather hotter", "they block out the Sun", "they fall into the sea every day"], "This space junk moves very fast and can damage working satellites and spacecraft.")

# ---------- build ----------
out = {}; n = 0
for u, qs in B.items():
    for k, q in enumerate(qs):
        q['id'] = f"ps{u}{k:02d}"; q['checked'] = 'human'
    out[u] = qs; n += len(qs)
letters = [q['correct_option'] for qs in out.values() for q in qs if q['type'] == 'mcq']
print(n, 'questions;', {u: len(v) for u, v in out.items()}, 'mcq letters', {c: letters.count(c) for c in 'ABCD'}, 'figures', sum(1 for qs in out.values() for q in qs if q.get('figure')))
json.dump(out, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
