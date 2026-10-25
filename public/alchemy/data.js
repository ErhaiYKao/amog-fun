/* Alchemy — game data. Edit this file to add or change recipes; the engine reads everything from here.
 *
 * ITEMS    id -> { name, icon: [shape, color, extra], desc, fuel: [heat, seconds], compost: units, place: true, plants }
 *          place: true means it is a building that sits on a tile of the island (barrels, sieves...). Crafted
 *          buildings go into the inventory; drag them onto the island. plants: placing this item puts that
 *          building down instead (a sapling plants a tree).
 * RECIPES  crafting: { in: {id: n}, out: {id: n}, at: "table", needs: {id: n}, name, scale: {per, k} }
 *          at: a building that must be on the island ("table", or "lab" for the alchemy lab). needs: items you must own, not used up.
 *          scale: inputs cost (1 + k * how many `per` you already have), rounded up. Used to stop barrel spam.
 * SMELT    furnace: input -> { out, time (s), heat }. Heat 1 = wood, 2 = charcoal, 3 = coal.
 * ALLOY    alloy smelter: output -> { in: {id: n}, n (made per job), time, heat }. Shares the furnace fuel.
 * CROPS    farmland: seed -> { grow (s), drops }. The seed stays planted and regrows forever.
 * AUTO     auto machines: id -> { action, kind (tool it holds: hammer/mesh/chammer), time (s) }.
 *          Each auto machine holds its own tool (best one taken when placed; swap it in the machine panel).
 *          Manual work uses your best one.
 * POWER    generators/storage: capacity (J), watts (J/s), optional fuel -> joules per item.
 * ELECTRIC powered stations: watts plus recipes { in, out, n, time }; all share the island's energy.
 * ACTIONS  the things you click. inputs map what you put in -> drop table. requires: a machine that must be
 *          built. needTool: power from `per` alone isn't enough, you need the tool too. toolName: for messages.
 * Drop tables are lists of [item, chance, amount, gate]. gate is a minimum mesh tier (number)
 *          or a tool kind you must own (string, e.g. "crook").
 * MOBS     monsters in the wilds: { name, area, hp, dmg (per hit), every (s between hits), xp, level (to fight, by the
 *          highest level you've reached, so spending levels never locks one again), drops, icon }. Your sword is CONFIG.tools.sword, your armor CONFIG.tools.armor.
 * AREAS    unlockable places off the island (they take no tiles): { name, unlock: {id: n}, desc }.
 * QUESTS   an advancement tree. need: { got: {id: n} } (ever obtained), { built: {id: n} },
 *          { anyBuilt: [ids] }, { gotAny: [ids] }, { land: tiles }, { area: id }, { enchanted: levels }. reward: {id: n}.
 *          Every completed quest also adds one tile of land (CONFIG.land). after: quest ids that
 *          must be done before it shows as open (set in QUEST_AFTER below). A quest completes whenever its need
 *          is met, open or not. Array order = display order and tie-break for the "main" open quest.
 * CONFIG   timings and balance.
 */
(function (root) {
  "use strict";

  const ITEMS = {
    // the tree
    log: { name: "Oak Log", icon: ["log", "#6b4a2b", "#b28a55"], fuel: [1, 15] },
    planks: { name: "Oak Planks", icon: ["planks", "#b08850"], fuel: [1, 7] },
    stick: { name: "Stick", icon: ["stick", "#8a6236"], fuel: [1, 2] },
    leaves: { name: "Oak Leaves", icon: ["leaves", "#3f7a2e"], compost: 1, desc: "Compost for barrels." },
    sapling: { name: "Oak Sapling", icon: ["sapling", "#4f8f35"], compost: 1, plants: "tree", desc: "Drag it onto an empty tile to plant another tree." },
    silkworm: { name: "Silkworm", icon: ["worm", "#ece6cc"], desc: "Shaken loose from leaves with a crook. Put it on leaves to farm string." },
    string: { name: "String", icon: ["string", "#f2efe6"] },
    twine: { name: "Twine", icon: ["twine", "#c9b27a"], desc: "Every proper tool needs a binding." },

    // earth
    dirt: { name: "Dirt", icon: ["block", "#7a5534", "dirt"], desc: "Sieve it, or spend it to grow the island." },
    seeds: { name: "Wheat Seeds", icon: ["seeds", "#a7c957"], compost: 1 },
    pebble: { name: "Stone Pebble", icon: ["pebble", "#8f8f8f"] },
    cobble: { name: "Cobblestone", icon: ["block", "#7b7b7b", "cobble"] },
    gravel: { name: "Gravel", icon: ["block", "#8a817c", "gravel"] },
    sand: { name: "Sand", icon: ["block", "#dccf9a", "sand"] },
    dust: { name: "Dust", icon: ["block", "#ebe5d3", "dust"] },
    clayBlock: { name: "Clay Block", icon: ["block", "#9aa6b5", "clay"] },
    clay: { name: "Clay Ball", icon: ["ball", "#a8b3c1"] },
    flint: { name: "Flint", icon: ["shard", "#3b3b42"] },
    // compressed blocks: 9 in one, for the compressed hammer and the heavy sieve
    cDirt: { name: "Compressed Dirt", icon: ["block", "#7a5534", "compressed"] },
    cCobble: { name: "Compressed Cobblestone", icon: ["block", "#7b7b7b", "compressed"] },
    cGravel: { name: "Compressed Gravel", icon: ["block", "#8a817c", "compressed"] },
    cSand: { name: "Compressed Sand", icon: ["block", "#dccf9a", "compressed"] },
    cDust: { name: "Compressed Dust", icon: ["block", "#ebe5d3", "compressed"] },
    // the wilds: combat, animals, books
    rottenFlesh: { name: "Rotten Flesh", icon: ["lump", "#7a8c3a"], compost: 2, desc: "Zombies drop it. Barrels compost it (worth 2 leaves)." },
    bone: { name: "Bone", icon: ["bone", "#e8e2d0"], desc: "Skeletons drop it. Grind it into bone meal." },
    boneMeal: { name: "Bone Meal", icon: ["pile", "#f0ece0"], desc: "Fertilizer: farmland set to use it grows each crop twice as fast." },
    blazeRod: { name: "Blaze Rod", icon: ["stick", "#f5a623"], fuel: [3, 240], desc: "From blazes in the Nether. Burns hot and long: 4 minutes of furnace heat, or 10,000 J in a fuel generator." },
    ghastTear: { name: "Ghast Tear", icon: ["gem", "#e8f4f8"], desc: "From ghasts in the Nether. The enchanting table can go past V with one tear per extra level." },
    flintSteel: { name: "Flint and Steel", icon: ["flintsteel"], desc: "Lights a Nether portal." },
    enderPearl: { name: "Ender Pearl", icon: ["ball", "#1f8f7a"], desc: "Endermen drop it. An enchanting table needs one." },
    wool: { name: "Wool", icon: ["block", "#eeeae0", "dust"], desc: "From the pasture's sheep. Pulls apart into 4 string." },
    leather: { name: "Leather", icon: ["hide", "#8b5a2b"], desc: "From the cow pasture. Armor and books." },
    rawBeef: { name: "Raw Beef", icon: ["lump", "#c0504d"], desc: "From the cow pasture. Cook it in a furnace." },
    steak: { name: "Steak", icon: ["lump", "#7a4a2a"], desc: "Eat it on the Dark Platform to heal 8 HP." },
    sugarcane: { name: "Sugarcane", icon: ["cane", "#7fbf5a"], desc: "Turns up when sieving sand. Plant it on farmland; it regrows. Paper comes from it." },
    paper: { name: "Paper", icon: ["sheet", "#f2efe6"] },
    book: { name: "Book", icon: ["book", "#8b3a2b"], desc: "Three paper bound in leather. The enchanting table wants one." },
    bookshelf: { name: "Bookshelf", icon: ["shelf", "#9a6b3a"], desc: "Keep them in your inventory: higher enchantment levels need more of them." },
    obsidian: { name: "Obsidian", icon: ["block", "#2a1f3d", "compressed"], desc: "Water poured onto lava. Very hard: geothermal generators and the last stretches of land need it." },
    glass: { name: "Glass", icon: ["block", "#bfe3ec", "dust"], desc: "Smelted sand. Solar panels and energy cells need it." },

    // heat and ore
    charcoal: { name: "Charcoal", icon: ["lump", "#3d3129"], fuel: [2, 60], desc: "Hot enough to fire clay. Not hot enough for iron." },
    coal: { name: "Coal", icon: ["lump", "#17171a"], fuel: [3, 80], desc: "The only fuel hot enough to smelt ore." },
    torch: { name: "Torch", icon: ["torch", "#8a6236"] },
    ironPiece: { name: "Iron Ore Piece", icon: ["pieces", "#d8af93"] },
    ironChunk: { name: "Iron Ore Chunk", icon: ["chunk", "#d8af93"] },
    iron: { name: "Iron Ingot", icon: ["ingot", "#dcdcdc"] },
    goldPiece: { name: "Gold Ore Piece", icon: ["pieces", "#f5cc3b"] },
    goldChunk: { name: "Gold Ore Chunk", icon: ["chunk", "#f5cc3b"] },
    gold: { name: "Gold Ingot", icon: ["ingot", "#f5cc3b"] },
    redstone: { name: "Redstone", icon: ["pile", "#d42a1f"] },
    glowstone: { name: "Glowstone Dust", icon: ["pile", "#f2d25e"] },
    diamond: { name: "Diamond", icon: ["gem", "#5ee0d8"] },
    emerald: { name: "Emerald", icon: ["gem", "#2ecc71"], desc: "Four diamonds, transmuted in an alchemy lab that holds a philosopher's stone. Emerald tools outdo diamond ones." },
    // transmuted in the alchemy lab, alloyed into constantan and invar
    copper: { name: "Copper Ingot", icon: ["ingot", "#d9824a"], desc: "Iron transmuted with redstone in an alchemy lab. Wires solar panels and energy cells." },
    nickel: { name: "Nickel Ingot", icon: ["ingot", "#c9c4a4"], desc: "Iron transmuted with glowstone in an alchemy lab. Alloyed into constantan and invar." },
    constantan: { name: "Constantan Ingot", icon: ["ingot", "#c7a27a"], desc: "Copper and nickel. Its resistance barely changes with heat, so geothermal thermocouples are made of it." },
    invar: { name: "Invar Ingot", icon: ["ingot", "#9fa89a"], desc: "Iron and nickel. It barely expands when heated: heating coils and heavy machine frames." },
    gear: { name: "Iron Gear", icon: ["gear", "#c9c9c9"] },
    steel: { name: "Steel Ingot", icon: ["ingot", "#7d8591"], desc: "Iron and coal, alloyed. The stuff heavy machinery is made of." },
    steelBlock: { name: "Block of Steel", icon: ["block", "#7d8591", "compressed"], desc: "Nine steel ingots. Late-game machines are built from these." },
    darkSteel: { name: "Dark Steel Ingot", icon: ["ingot", "#4a4e5c"], desc: "Steel alloyed with obsidian." },
    redAlloy: { name: "Redstone Alloy", icon: ["ingot", "#c0392b"], desc: "Iron soaked in redstone. Wires the heavy auto-machines." },
    paperclip: { name: "Paperclip", icon: ["paperclip", "#c9cdd4"], desc: "Eight per steel ingot. Does absolutely nothing. How many is enough?" },
    ironDust: { name: "Iron Dust", icon: ["pile", "#d8af93"], desc: "Smelts into an iron ingot. A crusher turns one ore chunk into two of these." },
    goldDust: { name: "Gold Dust", icon: ["pile", "#f5cc3b"], desc: "Smelts into a gold ingot. A crusher turns one ore chunk into two of these." },

    // farming (Mystical Agriculture, roughly)
    wheat: { name: "Wheat", icon: ["wheat", "#e3c35a"], compost: 3, desc: "Rich compost: worth 3 leaves in a barrel." },
    coalSeeds: { name: "Coal Seeds", icon: ["seeds", "#3a3a40"], desc: "Plant on farmland. Grows coal." },
    ironSeeds: { name: "Iron Seeds", icon: ["seeds", "#d8af93"], desc: "Plant on farmland. Grows iron ore pieces." },
    goldSeeds: { name: "Gold Seeds", icon: ["seeds", "#f5cc3b"], desc: "Plant on farmland. Grows gold ore pieces." },
    redstoneSeeds: { name: "Redstone Seeds", icon: ["seeds", "#d42a1f"], desc: "Plant on farmland. Grows redstone." },
    glowSeeds: { name: "Glowstone Seeds", icon: ["seeds", "#f2d25e"], desc: "Plant on farmland. Grows glowstone dust." },
    diamondSeeds: { name: "Diamond Seeds", icon: ["seeds", "#5ee0d8"], desc: "Plant on farmland. Grows a diamond, very slowly." },
    blazeSeeds: { name: "Blaze Seeds", icon: ["seeds", "#f5a623"], desc: "Plant on farmland. Grows blaze rods, slowly." },

    // clay work
    castRaw: { name: "Unfired Pickaxe Cast", icon: ["cast", "#a8b3c1"], desc: "Fire it in a furnace (charcoal heat)." },
    cast: { name: "Pickaxe Cast", icon: ["cast", "#b8643f"], desc: "Iron and diamond pickaxes are cast in it. Not used up." },
    bucketRaw: { name: "Unfired Clay Bucket", icon: ["bucket", "#a8b3c1"] },
    bucket: { name: "Clay Bucket", icon: ["bucket", "#b8643f"] },
    waterBucket: { name: "Water Bucket", icon: ["bucket", "#b8643f", "#3f76e4"] },
    lavaBucket: { name: "Lava Bucket", icon: ["bucket", "#b8643f", "#ff7a1a"] },
    ironBucket: { name: "Iron Bucket", icon: ["bucket", "#9ba1a8"], desc: "Clay is fine for water and lava, but a cow wants a proper pail. Milk one in the pasture." },
    milkBucket: { name: "Milk Bucket", icon: ["bucket", "#9ba1a8", "#fbfaf4"], desc: "Drink it on the Dark Platform or in the Nether to heal completely. You keep the iron bucket." },
    crucibleRaw: { name: "Unfired Crucible", icon: ["pot", "#a8b3c1"] },
    crucibleFired: { name: "Fired Crucible", icon: ["pot", "#b8643f"], desc: "Craft it with two torches into a crucible, which melts cobblestone into lava." },

    // tools (the best one you own is used; none are used up by clicking)
    crook: { name: "Crook", icon: ["crook", "#8a6236"] },
    woodAxe: { name: "Wooden Axe", icon: ["axe", "#b08850"] },
    stoneAxe: { name: "Stone Axe", icon: ["axe", "#8f8f8f"] },
    ironAxe: { name: "Iron Axe", icon: ["axe", "#dcdcdc"] },
    diamondAxe: { name: "Diamond Axe", icon: ["axe", "#5ee0d8"] },
    emeraldAxe: { name: "Emerald Axe", icon: ["axe", "#2ecc71"] },
    woodHammer: { name: "Wooden Hammer", icon: ["hammer", "#b08850"] },
    stoneHammer: { name: "Stone Hammer", icon: ["hammer", "#8f8f8f"] },
    ironHammer: { name: "Iron Hammer", icon: ["hammer", "#dcdcdc"] },
    diamondHammer: { name: "Diamond Hammer", icon: ["hammer", "#5ee0d8"] },
    emeraldHammer: { name: "Emerald Hammer", icon: ["hammer", "#2ecc71"] },
    stonePick: { name: "Stone Pickaxe", icon: ["pick", "#8f8f8f"] },
    ironPick: { name: "Iron Pickaxe", icon: ["pick", "#dcdcdc"] },
    diamondPick: { name: "Diamond Pickaxe", icon: ["pick", "#5ee0d8"] },
    emeraldPick: { name: "Emerald Pickaxe", icon: ["pick", "#2ecc71"] },
    stringMesh: { name: "String Mesh", icon: ["mesh", "#f2efe6"] },
    flintMesh: { name: "Flint Mesh", icon: ["mesh", "#55555e"] },
    ironMesh: { name: "Iron Mesh", icon: ["mesh", "#dcdcdc"] },
    diamondMesh: { name: "Diamond Mesh", icon: ["mesh", "#5ee0d8"] },
    emeraldMesh: { name: "Emerald Mesh", icon: ["mesh", "#2ecc71"], desc: "The luckiest mesh: every drop chance ×2.1." },
    woodSword: { name: "Wooden Sword", icon: ["sword", "#b08850"] },
    stoneSword: { name: "Stone Sword", icon: ["sword", "#8f8f8f"] },
    ironSword: { name: "Iron Sword", icon: ["sword", "#dcdcdc"] },
    diamondSword: { name: "Diamond Sword", icon: ["sword", "#5ee0d8"] },
    darkSteelSword: { name: "Dark Steel Sword", icon: ["sword", "#4a4e5c"] },
    leatherArmor: { name: "Leather Armor", icon: ["armor", "#8b5a2b"] },
    ironArmor: { name: "Iron Armor", icon: ["armor", "#dcdcdc"] },
    diamondArmor: { name: "Diamond Armor", icon: ["armor", "#5ee0d8"] },
    darkSteelArmor: { name: "Dark Steel Armor", icon: ["armor", "#4a4e5c"] },
    cHammer: { name: "Compressed Hammer", icon: ["hammer", "#6d747f"], desc: "Smashes compressed blocks: 9 at a time." },
    diamondCHammer: { name: "Diamond Compressed Hammer", icon: ["hammer", "#3fb8b0"] },
    pstone: { name: "Philosopher's Stone", icon: ["gem", "#e0243f", "glow"], desc: "Made in an alchemy lab from Nether spoils. Lets the lab transmute diamonds into emeralds. Not used up." },
    terminal: { name: "The Terminal Object", icon: ["terminal"], desc: "Every object has exactly one arrow to it." },

    // machines (each takes one tile of the island)
    tree: { name: "Oak Tree", icon: ["tree"], place: true, desc: "Drops leaves on its own once grown." },
    table: { name: "Crafting Table", icon: ["table"], place: true },
    barrel: { name: "Oak Barrel", icon: ["barrel", "#9a6b3a"], place: true, desc: "Turns 6 compost into dirt." },
    rainBarrel: { name: "Rain Barrel", icon: ["barrel", "#9a6b3a", "#3f76e4"], place: true, desc: "Fills with rainwater. Mix in dust for clay." },
    infested: { name: "Infested Leaves", icon: ["infested"], place: true, desc: "A silkworm colony. Spins string." },
    sieve: { name: "Sieve", icon: ["sieve"], place: true, desc: "Each sieve adds sieving power. Needs a mesh." },
    furnace: { name: "Furnace", icon: ["furnace"], place: true },
    crucible: { name: "Crucible", icon: ["crucible"], place: true, desc: "Melts cobblestone into lava." },
    cobblegen: { name: "Cobblestone Generator", icon: ["gen"], place: true, desc: "Water meets lava. Mine it with a pickaxe from the Work panel; every extra generator adds power to each swing." },
    autoGen: { name: "Auto-Generator Mk I", icon: ["autogen", "#dcdcdc"], place: true, desc: "Mines itself: 0.5 cobblestone/s. No pickaxe needed." },
    autoGen2: { name: "Auto-Generator Mk II", icon: ["autogen", "#f5cc3b"], place: true, desc: "Mines itself: 1.5 cobblestone/s." },
    autoGen3: { name: "Auto-Generator Mk III", icon: ["autogen", "#5ee0d8"], place: true, desc: "Mines itself: 4 cobblestone/s." },
    autoGen4: { name: "Auto-Generator Mk IV", icon: ["autogen", "#f5a623"], place: true, desc: "Blaze-powered: 10 cobblestone/s." },
    autoHammer: { name: "Auto-Hammer", icon: ["autohammer"], place: true, desc: "Holds its own hammer and takes your best one when placed. Better hammers work faster." },
    autoSieve: { name: "Auto-Sieve", icon: ["autosieve"], place: true, desc: "Holds its own mesh and takes your best one when placed. The mesh decides the drops." },
    alloy: { name: "Alloy Smelter", icon: ["furnace", "#5a6270"], place: true, desc: "Fuses metals into alloys, burning coal from the shared fuel store. Click it to queue recipes." },
    heavySieve: { name: "Heavy Sieve", icon: ["sieve", "#7d8591"], place: true, desc: "Sieves compressed blocks: 7 sievings in one. Needs a mesh." },
    autoCHammer: { name: "Auto Compressed Hammer", icon: ["chammerbox", "#7d8591"], place: true, desc: "Holds its own compressed hammer. Upgrade an auto-hammer or a compressed hammer into one." },
    autoHeavySieve: { name: "Auto Heavy Sieve", icon: ["autosieve", "#7d8591"], place: true, desc: "Holds its own mesh and sieves compressed blocks. Upgrade an auto-sieve or a heavy sieve into one." },
    farmland: { name: "Farmland", icon: ["farm"], place: true, desc: "Click it to pick a seed. A planted seed stays and keeps growing." },
    fuelGenerator: { name: "Fuel Generator", icon: ["fuelgen", "#df963b"], place: true, desc: "40 W; stores 4,000 J. Burns your chosen coal or charcoal only when the grid has room. Click it to pick the fuel." },
    solarGenerator: { name: "Solar Generator", icon: ["solar", "#4678bb"], place: true, desc: "10 W forever under the void's eternal sun. Stores 2,000 J; no fuel required." },
    geothermal: { name: "Geothermal Generator", icon: ["geo", "#ff7a1a"], place: true, desc: "150 W from lava: drinks it from your crucibles (or a lava bucket from your inventory) at 1 mB per 10 J. Stores 8,000 J." },
    enchantTable: { name: "Enchanting Table", icon: ["enchant"], place: true, desc: "Enchant your tools with XP levels." },
    mobGrinder: { name: "Mob Grinder", icon: ["grinder", "#c0392b"], place: true, desc: "40 W: fights a monster every 8 s for its drops and a little XP. Click it to pick which." },
    autoCompressor: { name: "Auto-Compressor", icon: ["compressor", "#e86a9a"], place: true, desc: "Squeezes 9 of a block into its compressed form (or 4 ore pieces into a chunk) every second. Click it to pick which." },
    battery: { name: "Energy Cell", icon: ["battery", "#76cfb3"], place: true, desc: "Adds 20,000 J of shared storage. Every powered machine connects automatically." },
    crusher: { name: "Crusher", icon: ["crusher", "#4fd6e8"], place: true, desc: "30 W. Doubles ore chunks into dust, or crushes stone into gravel, sand and dust. Click it to queue jobs." },
    energizedSmelter: { name: "Energized Smelter", icon: ["furnace", "#4fd6e8"], place: true, desc: "20 W. Smelts with electricity, twice as fast as a furnace. No heat or fuel requirement." },
    infuser: { name: "Metallurgic Infuser", icon: ["infuser", "#b98be3"], place: true, desc: "40 W. Makes steel and redstone alloy with half the coal or redstone. Click it to queue jobs." },
    lab: { name: "Alchemy Lab", icon: ["lab", "#9b59b6"], place: true, desc: "Transmutes one thing into another: cobblestone into coal, iron into copper and nickel, rotten flesh into leather, sand and dust into clay (and, with a philosopher's stone, diamonds into emeralds). Its recipes are in the crafting list; click it to auto-make one." },
    treeHarvester: { name: "Tree Harvester", icon: ["harvester", "#73aa56"], place: true, desc: "60 W for 10 s per tree: 4 logs, 4 leaves and a sapling. Replants by itself; trees take 45 s to regrow. Click it to pause or resume." },
  };

  const SIEVE = {
    dirt: [["pebble", 1, 2], ["pebble", 0.6, 1], ["pebble", 0.3, 1], ["seeds", 0.1, 1], ["sapling", 0.03, 1]],
    gravel: [["flint", 0.25, 1], ["coal", 0.12, 1], ["ironPiece", 0.3, 1], ["ironPiece", 0.15, 1],
      ["goldPiece", 0.08, 1, 2], ["diamond", 0.012, 1, 3]],
    sand: [["ironPiece", 0.5, 1], ["ironPiece", 0.25, 1], ["goldPiece", 0.25, 1], ["glowstone", 0.06, 1, 2], ["sugarcane", 0.04, 1]],
    dust: [["redstone", 0.3, 1], ["glowstone", 0.12, 1, 2], ["redstone", 0.1, 1, 3],
      ["clay", 0.15, 1], ["goldPiece", 0.12, 1, 2]],
  };
  // a heavy sieve rolls the normal table 7 times per compressed block (9 blocks' worth, a bit lossy, far fewer clicks)
  const HEAVY = { cDirt: "dirt", cGravel: "gravel", cSand: "sand", cDust: "dust" };
  const HEAVY_SIEVE = Object.fromEntries(Object.entries(HEAVY).map(([c, b]) => [c, Array(7).fill(SIEVE[b]).flat()]));

  const ACTIONS = {
    chop: { name: "Chop the tree", verb: "Chop", key: "1", work: 5, base: 1, tool: "axe", tree: true, drops: [["log", 1, 1]] },
    leaves: {
      name: "Shake the leaves", verb: "Shake", key: "2", work: 3, base: 1, tool: "crook", tree: true,
      drops: [["leaves", 1, 1], ["leaves", 0.5, 1], ["sapling", 0.12, 1], ["sapling", 0.2, 1, "crook"],
        ["stick", 0.1, 1], ["silkworm", 0.06, 1, "crook"]],
    },
    sieve: { name: "Sieve", verb: "Sieve", key: "3", work: 6, per: "sieve", mesh: true, inputs: SIEVE },
    hammer: {
      name: "Hammer", verb: "Smash", key: "4", work: 4, tool: "hammer",
      inputs: { cobble: [["gravel", 1, 1]], gravel: [["sand", 1, 1]], sand: [["dust", 1, 1]] },
    },
    chammer: {
      name: "Compressed hammer", verb: "Heavy smash", key: "6", work: 6, tool: "chammer", toolName: "compressed hammer", needTool: true,
      inputs: { cCobble: [["gravel", 1, 9]], cGravel: [["sand", 1, 9]], cSand: [["dust", 1, 9]] },
    },
    hsieve: { name: "Heavy sieve", verb: "Heavy sieve", key: "7", work: 8, per: "heavySieve", mesh: true, inputs: HEAVY_SIEVE },
    mine: {
      name: "Mine the generators", verb: "Mine", key: "5", work: 4, tool: "pick", per: "cobblegen", requires: "cobblegen", needTool: true,
      drops: [["cobble", 1, 1]],
    },
  };

  const SMELT = {
    log: { out: "charcoal", time: 6, heat: 1 },
    castRaw: { out: "cast", time: 15, heat: 2 },
    bucketRaw: { out: "bucket", time: 10, heat: 2 },
    crucibleRaw: { out: "crucibleFired", time: 20, heat: 2 },
    ironChunk: { out: "iron", time: 8, heat: 3 },
    goldChunk: { out: "gold", time: 8, heat: 3 },
    sand: { out: "glass", time: 5, heat: 2 },
    rawBeef: { out: "steak", time: 4, heat: 1 },
  };

  const ALLOY = {
    steel: { in: { iron: 1, coal: 2 }, n: 1, time: 12, heat: 3 },
    redAlloy: { in: { iron: 1, redstone: 4 }, n: 1, time: 10, heat: 3 },
    darkSteel: { in: { steel: 2, obsidian: 1 }, n: 1, time: 15, heat: 3 },
    constantan: { in: { copper: 1, nickel: 1 }, n: 2, time: 10, heat: 3 },
    invar: { in: { iron: 2, nickel: 1 }, n: 3, time: 12, heat: 3 },
  };

  const POWER = {
    fuelGenerator: { watts: 40, capacity: 4000, fuels: { coal: 3200, charcoal: 1600, blazeRod: 10000 } },
    solarGenerator: { watts: 10, capacity: 2000 },
    geothermal: { watts: 150, capacity: 8000, lavaPerJ: 0.1 }, // burns crucible lava (or lava buckets)
    battery: { watts: 0, capacity: 20000 },
  };
  const ELECTRIC = {
    crusher: { watts: 30, recipes: {
      ...Object.fromEntries([["cobble", "gravel"], ["gravel", "sand"], ["sand", "dust"]].map(([a, b]) =>
        [a, { in: { [a]: 1 }, out: b, n: 1, time: 2 }])),
      ironChunk: { in: { ironChunk: 1 }, out: "ironDust", n: 2, time: 3 },
      goldChunk: { in: { goldChunk: 1 }, out: "goldDust", n: 2, time: 3 },
      bone: { in: { bone: 1 }, out: "boneMeal", n: 4, time: 2 }, // crafted by hand a bone only gives 3
    } },
    energizedSmelter: { watts: 20, recipes: {
      ...Object.fromEntries(Object.entries(SMELT).map(([id, r]) =>
        [id, { in: { [id]: 1 }, out: r.out, n: 1, time: r.time / 2 }])),
      ironDust: { in: { ironDust: 1 }, out: "iron", n: 1, time: 4 },
      goldDust: { in: { goldDust: 1 }, out: "gold", n: 1, time: 4 },
    } },
    infuser: { watts: 40, recipes: {
      steel: { in: { iron: 1, coal: 1 }, out: "steel", n: 1, time: 6 },
      redAlloy: { in: { iron: 1, redstone: 2 }, out: "redAlloy", n: 1, time: 5 },
      darkSteel: { in: { steel: 1, obsidian: 1 }, out: "darkSteel", n: 1, time: 8 },
      constantan: { in: { copper: 1, nickel: 1 }, out: "constantan", n: 2, time: 5 },
      invar: { in: { iron: 2, nickel: 1 }, out: "invar", n: 3, time: 6 },
    } },
  };

  const CROPS = {
    seeds: { grow: 30, drops: [["wheat", 1, 1], ["seeds", 0.1, 1]] },
    coalSeeds: { grow: 60, drops: [["coal", 1, 1]] },
    ironSeeds: { grow: 45, drops: [["ironPiece", 1, 2]] },
    goldSeeds: { grow: 60, drops: [["goldPiece", 1, 2]] },
    redstoneSeeds: { grow: 60, drops: [["redstone", 1, 2]] },
    glowSeeds: { grow: 90, drops: [["glowstone", 1, 1]] },
    diamondSeeds: { grow: 480, drops: [["diamond", 1, 1]] },
    blazeSeeds: { grow: 300, drops: [["blazeRod", 1, 1]] },
    sugarcane: { grow: 40, drops: [["sugarcane", 1, 2]] },
  };

  const MOBS = {
    zombie: { name: "Zombie", area: "platform", hp: 10, dmg: 2, every: 1.6, xp: 4, level: 0, icon: ["mob", "#5d9b4a", "zombie"],
      drops: [["rottenFlesh", 1, 1], ["rottenFlesh", 0.5, 1], ["ironPiece", 0.05, 1]] },
    skeleton: { name: "Skeleton", area: "platform", hp: 14, dmg: 3, every: 1.4, xp: 6, level: 2, icon: ["mob", "#d8d4c4", "skeleton"],
      drops: [["bone", 1, 1], ["bone", 0.5, 1]] },
    spider: { name: "Spider", area: "platform", hp: 16, dmg: 3, every: 1, xp: 7, level: 4, icon: ["mob", "#2a2a33", "spider"],
      drops: [["string", 1, 2], ["string", 0.5, 1]] },
    enderman: { name: "Enderman", area: "platform", hp: 40, dmg: 7, every: 1.5, xp: 20, level: 10, icon: ["mob", "#151318", "enderman"],
      drops: [["enderPearl", 0.5, 1]] },
    // the Nether (through the portal)
    piglin: { name: "Zombified Piglin", area: "nether", hp: 30, dmg: 5, every: 1.4, xp: 16, level: 12, icon: ["mob", "#e3a4a0", "piglin"],
      drops: [["goldPiece", 1, 1], ["goldPiece", 0.5, 1], ["rottenFlesh", 0.5, 1]] },
    blaze: { name: "Blaze", area: "nether", hp: 36, dmg: 6, every: 1.1, xp: 24, level: 15, icon: ["mob", "#f2b233", "blaze"],
      drops: [["blazeRod", 0.6, 1]] },
    ghast: { name: "Ghast", area: "nether", hp: 26, dmg: 10, every: 2.6, xp: 30, level: 18, icon: ["mob", "#f2f0ec", "ghast"],
      drops: [["ghastTear", 0.5, 1]] },
  };

  const AREAS = {
    platform: { name: "Dark Platform", unlock: { cobble: 32, planks: 16 }, desc: "A slab of cobblestone off the edge of the island, kept dark so monsters spawn on it." },
    pasture: { name: "Cow Pasture", unlock: { planks: 32, stick: 16, wheat: 4 }, desc: "A fenced field below the island. Lure two cows in with wheat; feed them more to breed." },
    nether: { name: "The Nether", unlock: { obsidian: 10, flintSteel: 1 }, desc: "Build an obsidian frame on the island's underside and light it. Hotter, meaner monsters on the other side." },
  };

  const AUTO = {
    autoHammer: { action: "hammer", kind: "hammer", time: 2.5 },
    autoSieve: { action: "sieve", kind: "mesh", time: 3 },
    autoCHammer: { action: "chammer", kind: "chammer", time: 5 },
    autoHeavySieve: { action: "hsieve", kind: "mesh", time: 6 },
  };

  const RECIPES = [
    { in: { steel: 1 }, out: { paperclip: 8 }, at: "table" },
    { in: { steel: 4, gear: 2, redAlloy: 2 }, out: { fuelGenerator: 1 }, at: "table" },
    { in: { steel: 2, gold: 2, copper: 4, redAlloy: 2, glowstone: 4, glass: 8 }, out: { solarGenerator: 1 }, at: "table" },
    { in: { steel: 2, copper: 6, redAlloy: 2, glass: 4 }, out: { battery: 1 }, at: "table" },
    { in: { obsidian: 8, steelBlock: 1, constantan: 4, gear: 4 }, out: { geothermal: 1 }, at: "table" }, // constantan thermocouples
    { in: { steel: 2, gear: 2, redAlloy: 2, cCobble: 2 }, out: { autoCompressor: 1 }, at: "table" },
    // the wilds
    { in: { planks: 2, stick: 1 }, out: { woodSword: 1 }, at: "table" },
    { in: { cobble: 2, stick: 1, twine: 1 }, out: { stoneSword: 1 }, at: "table" },
    { in: { iron: 2, stick: 1, twine: 1 }, out: { ironSword: 1 }, at: "table" },
    { in: { diamond: 2, stick: 1, twine: 1 }, out: { diamondSword: 1 }, at: "table" },
    { in: { leather: 8 }, out: { leatherArmor: 1 }, at: "table" },
    { in: { iron: 12, leather: 2 }, out: { ironArmor: 1 }, at: "table" },
    { in: { diamond: 12, leather: 2 }, out: { diamondArmor: 1 }, at: "table" },
    { in: { bone: 1 }, out: { boneMeal: 3 } },
    { in: { iron: 1, flint: 1 }, out: { flintSteel: 1 } },
    { in: { wool: 1 }, out: { string: 4 } },
    { in: { diamondSword: 1, darkSteel: 3, blazeRod: 1 }, out: { darkSteelSword: 1 }, at: "table" },
    { in: { diamondArmor: 1, darkSteel: 8 }, out: { darkSteelArmor: 1 }, at: "table" },
    { in: { sugarcane: 3 }, out: { paper: 3 } },
    { in: { paper: 3, leather: 1 }, out: { book: 1 } },
    { in: { book: 1, diamond: 2, obsidian: 4, enderPearl: 1 }, out: { enchantTable: 1 }, at: "table" },
    { in: { planks: 6, book: 3 }, out: { bookshelf: 1 }, at: "table" },
    { in: { steelBlock: 1, invar: 4, ironSword: 1, redAlloy: 2, gear: 2 }, out: { mobGrinder: 1 }, at: "table" },
    { name: "Pour water onto lava", in: { lavaBucket: 1, waterBucket: 1 }, out: { obsidian: 1, bucket: 1, waterBucket: 1 } },
    { in: { steel: 4, gear: 2, redAlloy: 2, cobble: 8 }, out: { crusher: 1 }, at: "table" },
    { in: { steel: 2, invar: 4, redAlloy: 2, cobble: 8 }, out: { energizedSmelter: 1 }, at: "table" }, // an invar heating coil
    { in: { steel: 4, gear: 2, redAlloy: 4 }, out: { infuser: 1 }, at: "table" },
    { in: { steel: 4, gear: 2, redAlloy: 4, ironAxe: 1 }, out: { treeHarvester: 1 }, at: "table" },
    { in: { log: 1 }, out: { planks: 4 } },
    { in: { planks: 2 }, out: { stick: 4 } },
    { in: { planks: 4 }, out: { table: 1 } },
    { in: { stick: 5 }, out: { crook: 1 }, at: "table" },
    { in: { planks: 7 }, out: { barrel: 1 }, at: "table" },
    { in: { silkworm: 1, leaves: 6 }, out: { infested: 1 } },
    { in: { string: 3 }, out: { twine: 1 } },
    { in: { string: 6, stick: 2 }, out: { stringMesh: 1 }, at: "table" },
    { in: { planks: 3, stick: 2 }, out: { sieve: 1 }, at: "table" },
    { in: { pebble: 4 }, out: { cobble: 1 } },
    { in: { planks: 3, stick: 2, twine: 1 }, out: { woodHammer: 1 }, at: "table" },
    { in: { planks: 3, stick: 2, twine: 1 }, out: { woodAxe: 1 }, at: "table" },
    { in: { cobble: 2, stick: 2, twine: 1 }, out: { stoneHammer: 1 }, at: "table" },
    { in: { cobble: 3, stick: 2, twine: 1 }, out: { stoneAxe: 1 }, at: "table" },
    { in: { cobble: 3, stick: 2, twine: 2 }, out: { stonePick: 1 }, at: "table" },
    { in: { cobble: 8 }, out: { furnace: 1 }, at: "table" },
    { in: { planks: 7, stick: 2 }, out: { rainBarrel: 1 }, at: "table" },
    { in: { clayBlock: 1 }, out: { clay: 4 } },
    { in: { clay: 5 }, out: { castRaw: 1 }, at: "table" },
    { in: { clay: 3 }, out: { bucketRaw: 1 }, at: "table" },
    { in: { iron: 3 }, out: { ironBucket: 1 }, at: "table" },
    { in: { clay: 6 }, out: { crucibleRaw: 1 }, at: "table" },
    { in: { stick: 1, charcoal: 1 }, out: { torch: 4 } },
    { in: { stick: 1, coal: 1 }, out: { torch: 4 } },
    { in: { crucibleFired: 1, torch: 2 }, out: { crucible: 1 }, at: "table" },
    { in: { waterBucket: 1, lavaBucket: 1, cobble: 4 }, out: { cobblegen: 1 }, at: "table" }, // the buckets go in with the fluids
    { name: "Empty water bucket", in: { waterBucket: 1 }, out: { bucket: 1 } }, // pour it out
    { name: "Empty lava bucket", in: { lavaBucket: 1 }, out: { bucket: 1 } },
    { in: { ironPiece: 4 }, out: { ironChunk: 1 } },
    { in: { goldPiece: 4 }, out: { goldChunk: 1 } },
    { in: { flint: 6, stringMesh: 1 }, out: { flintMesh: 1 }, at: "table" },
    { in: { iron: 3, stick: 2, twine: 2 }, needs: { cast: 1 }, out: { ironPick: 1 }, at: "table" },
    { in: { iron: 2, stick: 2, twine: 1 }, out: { ironHammer: 1 }, at: "table" },
    { in: { iron: 3, stick: 2, twine: 1 }, out: { ironAxe: 1 }, at: "table" },
    { in: { iron: 4, flintMesh: 1 }, out: { ironMesh: 1 }, at: "table" },
    { in: { iron: 2 }, out: { gear: 1 }, at: "table" },
    { in: { gear: 1, redstone: 2, cobble: 8 }, out: { autoHammer: 1 }, at: "table" }, // insert any hammer afterwards
    { in: { sieve: 1, gear: 1, redstone: 2 }, out: { autoSieve: 1 }, at: "table" },
    // auto-generators: their own upgrade path, each tier is built from the one before
    { in: { cobblegen: 1, gear: 2, redstone: 4, cobble: 16 }, out: { autoGen: 1 }, at: "table" },
    { in: { autoGen: 1, gear: 2, gold: 4, redstone: 8 }, out: { autoGen2: 1 }, at: "table" },
    { in: { autoGen2: 1, diamond: 2, gold: 4, glowstone: 8 }, out: { autoGen3: 1 }, at: "table" },
    { in: { autoGen3: 1, blazeRod: 8, diamond: 4, invar: 8, obsidian: 4, steelBlock: 2 }, out: { autoGen4: 1 }, at: "table" },
    { in: { diamond: 3, stick: 2, twine: 2 }, needs: { cast: 1 }, out: { diamondPick: 1 }, at: "table" },
    { in: { diamond: 2, stick: 2, twine: 1 }, out: { diamondHammer: 1 }, at: "table" },
    { in: { diamond: 3, stick: 2, twine: 1 }, out: { diamondAxe: 1 }, at: "table" },
    { in: { diamond: 4, ironMesh: 1 }, out: { diamondMesh: 1 }, at: "table" },
    { in: { emerald: 3, stick: 2, twine: 2 }, needs: { cast: 1 }, out: { emeraldPick: 1 }, at: "table" },
    { in: { emerald: 2, stick: 2, twine: 1 }, out: { emeraldHammer: 1 }, at: "table" },
    { in: { emerald: 3, stick: 2, twine: 1 }, out: { emeraldAxe: 1 }, at: "table" },
    { in: { emerald: 4, diamondMesh: 1 }, out: { emeraldMesh: 1 }, at: "table" },
    { in: { glass: 6, gold: 4, redstone: 8, glowstone: 4, diamond: 1 }, out: { lab: 1 }, at: "table" },
    // transmutation happens in the alchemy lab (at: "lab"); the lab or a table can auto-make it
    { name: "Transmute", in: { cobble: 16 }, out: { coal: 1 }, at: "lab" },
    { name: "Transmute", in: { iron: 1, redstone: 2 }, out: { copper: 1 }, at: "lab" },
    { name: "Transmute", in: { iron: 2, glowstone: 1 }, out: { nickel: 2 }, at: "lab" },
    { name: "Transmute", in: { rottenFlesh: 4 }, out: { leather: 1 }, at: "lab" },
    { name: "Transmute", in: { sand: 8, dust: 8 }, out: { clayBlock: 2 }, at: "lab" },
    { in: { diamond: 4, glowstone: 16, redstone: 16, blazeRod: 2, ghastTear: 1, invar: 4 }, out: { pstone: 1 }, at: "lab" },
    { name: "Transmute", in: { diamond: 4 }, needs: { pstone: 1 }, out: { emerald: 1 }, at: "lab" },
    // compressed blocks, both ways
    ...[["dirt", "cDirt"], ["cobble", "cCobble"], ["gravel", "cGravel"], ["sand", "cSand"], ["dust", "cDust"], ["steel", "steelBlock"]].flatMap(([b, c]) => [
      { in: { [b]: 9 }, out: { [c]: 1 } },
      { name: "Uncompress", in: { [c]: 1 }, out: { [b]: 9 } },
    ]),
    // heavy machinery: the manual ones are iron-age, the automatic ones need steel (as in SF3)
    { in: { cCobble: 3, iron: 2, twine: 2 }, out: { cHammer: 1 }, at: "table" },
    { in: { diamond: 3, cHammer: 1, twine: 2 }, out: { diamondCHammer: 1 }, at: "table" },
    { in: { sieve: 1, cCobble: 2, iron: 2 }, out: { heavySieve: 1 }, at: "table" },
    { in: { furnace: 1, iron: 6, gear: 2 }, out: { alloy: 1 }, at: "table" },
    // auto versions: upgrade either the auto machine or the manual heavy one (a compressed hammer goes in as its tool)
    { in: { autoHammer: 1, steel: 4, redAlloy: 4 }, out: { autoCHammer: 1 }, at: "table" },
    { in: { cHammer: 1, gear: 2, steel: 4, redAlloy: 4 }, out: { autoCHammer: 1 }, at: "table" },
    { in: { autoSieve: 1, steel: 4, redAlloy: 4 }, out: { autoHeavySieve: 1 }, at: "table" },
    { in: { heavySieve: 1, gear: 2, steel: 4, redAlloy: 4 }, out: { autoHeavySieve: 1 }, at: "table" },
    // farming
    { in: { dirt: 4, waterBucket: 1 }, out: { farmland: 1, bucket: 1 }, at: "table" },
    { in: { seeds: 1, coal: 16 }, out: { coalSeeds: 1 }, at: "table" },
    { in: { seeds: 1, iron: 8 }, out: { ironSeeds: 1 }, at: "table" },
    { in: { seeds: 1, gold: 8 }, out: { goldSeeds: 1 }, at: "table" },
    { in: { seeds: 1, redstone: 32 }, out: { redstoneSeeds: 1 }, at: "table" },
    { in: { seeds: 1, glowstone: 16 }, out: { glowSeeds: 1 }, at: "table" },
    { in: { seeds: 1, diamond: 8, steelBlock: 1 }, out: { diamondSeeds: 1 }, at: "table" },
    { in: { seeds: 1, blazeRod: 12, steelBlock: 1 }, out: { blazeSeeds: 1 }, at: "table" },
    { in: { diamond: 12, emerald: 4, gold: 32, steelBlock: 4, darkSteel: 4, constantan: 8, invar: 8, redstone: 32, glowstone: 32, blazeRod: 8, ghastTear: 4, enderPearl: 8 }, needs: { pstone: 1 }, out: { terminal: 1 }, at: "table" },
  ];

  const QUESTS = [
    { id: "wood", title: "Punch the Tree", text: "Click Chop until you have 3 oak logs.", need: { got: { log: 3 } } },
    { id: "planks", title: "Planks", text: "Turn a log into planks in the crafting list.", need: { got: { planks: 4 } } },
    { id: "table", title: "A Table in the Void", text: "Craft a crafting table, then drag it from your inventory onto the island. Every building takes one tile.", need: { built: { table: 1 } } },
    { id: "leaves", title: "Leaf Peeping", text: "Shake the leaves. Leaves rot into dirt and saplings grow into trees.", need: { got: { leaves: 6 } }, reward: { sapling: 1 } },
    { id: "crook", title: "By Hook or by Crook", text: "Make a crook: faster shaking, more saplings, and the odd silkworm.", need: { got: { crook: 1 } } },
    { id: "barrel", title: "Barrel", text: "Craft an oak barrel and place it on the island. It pulls leaves from your inventory and composts them.", need: { built: { barrel: 1 } } },
    { id: "dirt", title: "Dirt From Nothing", text: "Six compost in a barrel rot into a block of dirt.", need: { got: { dirt: 1 } } },
    { id: "grow", title: "Another Tree", text: "Drag a sapling from your inventory onto an empty tile to plant it. Grown trees drop leaves by themselves.", need: { built: { tree: 2 } } },
    { id: "land", title: "More Land", text: "Every quest and advancement you complete adds a tile of land to the island. Keep going and the island keeps growing.", need: { land: 7 } },
    { id: "silk", title: "Silkworm", text: "Keep shaking leaves with the crook until a silkworm falls out.", need: { got: { silkworm: 1 } } },
    { id: "infest", title: "Infested Leaves", text: "Put the silkworm on leaves. The colony spins string forever.", need: { built: { infested: 1 } } },
    { id: "string", title: "String Theory", text: "Collect 6 string.", need: { got: { string: 6 } } },
    { id: "sieve", title: "Sift", text: "Build a sieve and a string mesh, then sieve dirt for pebbles.", need: { got: { pebble: 1 } } },
    { id: "cobble", title: "Cobblestone", text: "Four pebbles make a cobblestone.", need: { got: { cobble: 4 } } },
    { id: "twine", title: "Twine", text: "Tools need a binding. Twist 3 string into twine.", need: { got: { twine: 1 } } },
    { id: "hammer", title: "Hammer Time", text: "Make a hammer and smash cobblestone into gravel.", need: { got: { gravel: 1 } } },
    { id: "furnace", title: "Furnace", text: "Build a furnace from 8 cobblestone.", need: { built: { furnace: 1 } } },
    { id: "charcoal", title: "Charcoal", text: "Fuel the furnace with planks and smelt a log.", need: { got: { charcoal: 1 } } },
    { id: "clay", title: "Clay", text: "Build a rain barrel and let it fill. Hammer sand into dust and mix it in.", need: { got: { clayBlock: 1 } } },
    { id: "crucible", title: "Crucible", text: "Fire a clay crucible and set it over torches. It melts cobblestone into lava.", need: { built: { crucible: 1 } } },
    { id: "gen", title: "Infinite Cobblestone", text: "A bucket of water and a bucket of lava make a generator (the buckets go with them). Mine it with a pickaxe from the Work panel.", need: { built: { cobblegen: 1 } } },
    { id: "coal", title: "Real Coal", text: "Sieve gravel for coal. Only coal burns hot enough for ore.", need: { got: { coal: 1 } } },
    { id: "iron", title: "Iron Age", text: "Four iron pieces make a chunk. Smelt it with coal.", need: { got: { iron: 1 } } },
    { id: "farm", title: "Green Thumb", text: "Build farmland (dirt and a water bucket) and plant wheat seeds from sieving dirt. Wheat is rich compost; later, seeds can grow ore.", need: { built: { farmland: 1 } } },
    { id: "cast", title: "Pickaxe Cast", text: "Mould a pickaxe cast from clay and fire it.", need: { got: { cast: 1 } } },
    { id: "ironpick", title: "Iron Pickaxe", text: "Cast an iron pickaxe. Every swing at the generators mines far more.", need: { got: { ironPick: 1 } } },
    { id: "auto", title: "Automation", text: "Build an auto-hammer or an auto-sieve. Redstone comes from sieving dust. Each one can be set to its own input, so you can chain them.", need: { anyBuilt: ["autoHammer", "autoSieve"] } },
    { id: "autogen", title: "Hands-Free Stone", text: "Upgrade a cobblestone generator into an auto-generator. It mines itself, and has its own upgrades.", need: { anyBuilt: ["autoGen", "autoGen2", "autoGen3", "autoGen4"] } },
    { id: "heavy", title: "Heavy Machinery", text: "Compress blocks 9 to 1, then build a heavy sieve or a compressed hammer to work them all at once.", need: { gotAny: ["heavySieve", "cHammer"] } },
    { id: "diamond", title: "Diamonds", text: "An iron mesh finds diamonds in gravel.", need: { got: { diamond: 1 } } },
    { id: "alloy", title: "Alloy Smelter", text: "Build an alloy smelter from a furnace, iron and gears. Click it on the island to queue recipes.", need: { built: { alloy: 1 } } },
    { id: "steel", title: "Steel", text: "Alloy iron with coal. Steel is what the automatic heavy machines are made of.", need: { got: { steel: 1 } } },
    { id: "lab", title: "The Alchemist", text: "Build an alchemy lab from glass, gold, redstone, glowstone and a diamond. Its transmutations show up in the crafting list.", need: { built: { lab: 1 } } },
    { id: "metals", title: "Base Metals", text: "Transmute iron into copper (with redstone) and nickel (with glowstone) in the alchemy lab.", need: { got: { copper: 1, nickel: 1 } } },
    { id: "alloys", title: "Thermal Expansion", text: "Alloy copper and nickel into constantan, and iron and nickel into invar. Geothermal generators, energized smelters and mob grinders are built from them.", need: { got: { constantan: 1, invar: 1 } } },
    { id: "power", title: "Watt Now?", text: "Build a fuel or solar generator. All powered machines share one grid: 1 watt supplies 1 joule each second. Click a generator to configure it.", need: { anyBuilt: ["fuelGenerator", "solarGenerator"] } },
    { id: "orepower", title: "Double or Nothing", text: "Build a crusher and an energized smelter. Crush one ore chunk into two dust, then smelt them into two ingots.", need: { built: { crusher: 1, energizedSmelter: 1 } } },
    { id: "infusion", title: "Applied Metallurgy", text: "Build a metallurgic infuser to make alloys faster with less coal and redstone.", need: { built: { infuser: 1 } } },
    { id: "forestry", title: "The Forest Works for You", text: "Build a tree harvester. It uses 600 J per harvest and replants automatically; plant more trees to keep it busy.", need: { built: { treeHarvester: 1 } } },
    { id: "storage", title: "Potential Energy", text: "Build an energy cell to store 20,000 more joules for later.", need: { built: { battery: 1 } } },
    { id: "fight", title: "First Blood", text: "Unlock the Dark Platform in the Wilds, craft a sword and fight a zombie.", need: { got: { rottenFlesh: 1 } } },
    { id: "milk", title: "Got Milk?", text: "Make an iron bucket and milk a cow in the pasture. Drinking it in a fight heals you completely.", need: { got: { milkBucket: 1 } } },
    { id: "moo", title: "Moo", text: "Unlock the cow pasture in the Wilds. Cows give leather and beef; feed them wheat to breed more.", need: { area: "pasture" } },
    { id: "baa", title: "Baa", text: "Lure two sheep into the pasture with wheat. Wool pulls apart into string.", need: { got: { wool: 1 } } },
    { id: "bookworm", title: "Bookworm", text: "Sieve sand for sugarcane, grow it on farmland, and bind three paper in leather into a book.", need: { got: { book: 1 } } },
    { id: "ender", title: "The End?", text: "Reach level 10 and take an ender pearl from an enderman. Bring armor.", need: { got: { enderPearl: 1 } } },
    { id: "enchant", title: "Enchanted", text: "Build an enchanting table and spend XP levels enchanting a tool.", need: { enchanted: 1 } },
    { id: "nether", title: "Through the Portal", text: "Ten obsidian and a flint and steel open the Nether in the Wilds.", need: { area: "nether" } },
    { id: "blaze", title: "Hot Property", text: "Reach level 15 and take a blaze rod from a blaze. It's superb fuel.", need: { got: { blazeRod: 1 } } },
    { id: "tear", title: "Crying Shame", text: "Reach level 18 and bring back a ghast tear. It lets enchantments go past V.", need: { got: { ghastTear: 1 } } },
    { id: "pstone", title: "The Philosopher's Stone", text: "Diamonds, glowstone, redstone, blaze rods, a ghast tear and invar make a philosopher's stone in the alchemy lab.", need: { got: { pstone: 1 } } },
    { id: "emerald", title: "Green With Envy", text: "With the stone in hand, the lab turns four diamonds into an emerald. Emerald tools beat diamond ones.", need: { got: { emerald: 1 } } },
    { id: "darksteel", title: "Dark Arts", text: "Alloy steel with obsidian into dark steel. It upgrades diamond swords and armor.", need: { got: { darkSteel: 1 } } },
    { id: "blazefarm", title: "Hellfire Harvest", text: "Make blaze seeds and plant them on farmland.", need: { got: { blazeSeeds: 1 } } },
    { id: "grind", title: "Grind Time", text: "Build a powered mob grinder to farm monster drops while you do other things.", need: { built: { mobGrinder: 1 } } },
    { id: "geo", title: "Hot Rocks", text: "Pour water onto lava for obsidian, then build a geothermal generator. It turns crucible lava into 150 W.", need: { built: { geothermal: 1 } } },
    { id: "compress", title: "Squeeze Play", text: "Build an auto-compressor. Point one at dust, put it between your auto-hammers and an auto heavy sieve, and the dust farm runs itself.", need: { built: { autoCompressor: 1 } } },
    { id: "clips", title: "A Perfectly Harmless Objective", text: "Turn a steel ingot into eight paperclips. They do nothing. Maximizing them is entirely your decision.", need: { got: { paperclip: 8 } } },
    { id: "terminal", title: "The Terminal Object", text: "Every object in the void has a unique arrow to it. It takes a bit of everything, from diamonds to ghast tears. Build it to finish.", need: { got: { terminal: 1 } } },
  ];

  // the advancement tree: which quests open up which
  const QUEST_AFTER = {
    planks: ["wood"], table: ["planks"], leaves: ["wood"], crook: ["table", "leaves"], barrel: ["table"], dirt: ["barrel"],
    grow: ["leaves"], land: ["dirt"], silk: ["crook"], infest: ["silk"], string: ["infest"], sieve: ["string", "dirt"],
    cobble: ["sieve"], twine: ["string"], hammer: ["cobble", "twine"], furnace: ["cobble"], charcoal: ["furnace"],
    clay: ["hammer"], crucible: ["clay", "charcoal"], gen: ["crucible"], coal: ["hammer"], iron: ["coal", "furnace"],
    farm: ["clay", "charcoal"], cast: ["clay", "charcoal"], ironpick: ["cast", "iron"], auto: ["iron"],
    autogen: ["auto", "gen"], heavy: ["iron"], diamond: ["iron"], alloy: ["iron"], steel: ["alloy"],
    lab: ["diamond"], metals: ["lab"], alloys: ["metals", "alloy"], pstone: ["alloys", "blaze", "tear"], emerald: ["pstone"], milk: ["moo", "iron"],
    terminal: ["emerald", "steel", "blaze", "tear", "darksteel"], geo: ["power", "alloys"], fight: ["cobble"], moo: ["farm"], baa: ["moo"], bookworm: ["moo"], darksteel: ["geo", "alloy"], blazefarm: ["blaze"], ender: ["fight", "iron"],
    enchant: ["bookworm", "ender", "diamond"], grind: ["fight", "power"], nether: ["ender", "geo"], blaze: ["nether"], tear: ["nether"], compress: ["steel", "heavy"],
    power: ["steel"], orepower: ["power", "alloys"], infusion: ["power"], forestry: ["power"], storage: ["power", "metals"], clips: ["steel"],
  };
  QUESTS.forEach(q => (q.after = QUEST_AFTER[q.id] || []));

  const CONFIG = {
    start: { land: 6 },
    // land: every completed quest/advancement adds a tile (no buying land); the 9×7 map holds 63
    land: { max: 63, perQuest: 1 },
    combat: { hp: 20, regen: 1, faint: 10, fist: 1, armorPct: 0.04, armorSoft: 0.6, armorMax: 0.9, levelXp: 10, steakHeal: 8, calm: 4 },
    // cows come with the pasture; sheep are lured in (lure brings `start` of them), then bred like cows
    pasture: { start: 2, max: 12, every: 40, breed: { wheat: 2 }, drops: [["leather", 1, 1], ["rawBeef", 0.6, 1]],
      sheep: { lure: { wheat: 6 }, start: 2, max: 12, every: 30, breed: { wheat: 2 }, drops: [["wool", 1, 1], ["wool", 0.25, 1]] } },
    // enchantments, keyed by id (tools use their kind as the id). n-th level costs cost·n XP levels; past `max`
    // each level also takes a ghast tear, up to `maxTear`. Applies to every tool of that kind, including tools
    // slotted into auto machines (better tools = faster auto-hammers/sieves).
    // shelves[n]: bookshelves you must have in your inventory for an enchantment to reach level n
    enchant: { max: 5, maxTear: 8, perLevel: 0.25, cost: 3, shelves: [0, 0, 0, 4, 8, 12, 15, 15, 15], types: {
      sword: { kind: "sword", name: "Sharpness" }, armor: { kind: "armor", name: "Protection" },
      axe: { kind: "axe", name: "Efficiency" }, crook: { kind: "crook", name: "Efficiency" }, pick: { kind: "pick", name: "Efficiency" },
      hammer: { kind: "hammer", name: "Efficiency" }, chammer: { kind: "chammer", name: "Efficiency" },
      meshEff: { kind: "mesh", name: "Efficiency" },                     // faster sieving (manual and auto)
      meshFortune: { kind: "mesh", name: "Fortune", perLevel: 0.1 },     // +10% drop chances per level
    } },
    grinder: { watts: 40, time: 8, xp: 1 }, // grinds any monster you could fight (level and area)
    craftMax: 64, // the most one click crafts (the ×max button and the amount box)
    autocraft: { time: 1, limit: 64 }, // tables and machines set to auto-make an item, unlocked by the Automation quest
    compress: { time: 1, map: { dirt: ["cDirt", 9], cobble: ["cCobble", 9], gravel: ["cGravel", 9], sand: ["cSand", 9], dust: ["cDust", 9],
      ironPiece: ["ironChunk", 4], goldPiece: ["goldChunk", 4], steel: ["steelBlock", 9] } }, // input -> [output, how many in]
    tree: { grow: 45, litter: 20, drops: [["leaves", 1, 1], ["sapling", 0.12, 1], ["stick", 0.06, 1]] },
    barrel: { units: 6, time: 8 },
    rain: { time: 30 },
    infested: { time: 15, drops: [["string", 1, 1], ["silkworm", 0.03, 1]] },
    crucible: { cobble: 4, melt: 10, perCobble: 250, lava: 4000 }, // a bucket is 1000 mB
    autoGen: { autoGen: 0.5, autoGen2: 1.5, autoGen3: 4, autoGen4: 10 }, // cobblestone per second
    harvester: { watts: 60, time: 10, drops: { log: 4, leaves: 4, sapling: 1 } },
    reserve: { cobble: 16, leaves: 6, seeds: 4, wheat: 8 }, // auto machines and barrels leave this much for crafting, planting (and luring cows)
    offline: 7200, // seconds of progress credited while the tab is closed
    tools: {
      axe: [["woodAxe", 1], ["stoneAxe", 2], ["ironAxe", 4], ["diamondAxe", 7], ["emeraldAxe", 10]], // extra chopping power
      crook: [["crook", 2]], // extra shaking power
      hammer: [["woodHammer", 1], ["stoneHammer", 2], ["ironHammer", 4], ["diamondHammer", 8], ["emeraldHammer", 12]],
      pick: [["stonePick", 1], ["ironPick", 3], ["diamondPick", 6], ["emeraldPick", 9]], // mining power per swing (plus 1 per generator)
      mesh: [["stringMesh", 1], ["flintMesh", 2], ["ironMesh", 3], ["diamondMesh", 4], ["emeraldMesh", 5]],
      chammer: [["cHammer", 3], ["diamondCHammer", 6]],
      sword: [["woodSword", 2], ["stoneSword", 3], ["ironSword", 5], ["diamondSword", 8], ["darkSteelSword", 11]], // damage per hit
      armor: [["leatherArmor", 4], ["ironArmor", 10], ["diamondArmor", 16], ["darkSteelArmor", 21]], // each point blocks 4% of a hit, softly capped (engine armorBlock)
    },
    meshLuck: [0, 1, 1.25, 1.5, 1.8, 2.1], // drop chance multiplier per mesh tier
  };

  const DATA = { ITEMS, RECIPES, SMELT, ALLOY, POWER, ELECTRIC, CROPS, MOBS, AREAS, AUTO, SIEVE, HEAVY_SIEVE, ACTIONS, QUESTS, CONFIG };
  root.ALCHEMY_DATA = DATA;
  if (typeof module !== "undefined" && module.exports) module.exports = DATA;
})(typeof window !== "undefined" ? window : globalThis);
