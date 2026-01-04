# Mechanical Parts for LED Cube

This directory contains all the 3D models and specifications for building the physical structure of the 1×1×1m LED cube.

## Overview

The cube structure consists of:
- **Carbon fiber tubes** forming the main frame (12 edges of the cube)
- **3D printed connectors** to join the tubes at corners and base
- **3D printed cable management** combs to route LED wires
- **MDF base** housing all electronics
- **Controller mounting hardware**

## Bill of Materials

### Structural Components

#### Carbon Fiber Tubes

Ordered from "CARBON TIME" store on AliExpress:
- **Store:** [CARBON TIME](https://de.aliexpress.com/store/911756291)
- **Product:** [20mm Carbon Fiber Tubes](https://de.aliexpress.com/item/1005002337416341.html)

**Quantities needed:**
- 9× tubes 20×18×1000mm (outer × inner × length)
- 3× tubes 20×16×1000mm (for bottom connections to base)
  - Note: 20×18mm can be used for everything if you prefer consistency

**Finish:** Twill matte

#### LED Strings

**Product:** WS2812B addressable LED string ([AliExpress link](https://de.aliexpress.com/item/1005001915144430.html))

**Specifications:**
- 20m string with 10 LEDs per meter (200 LEDs total per string)
- 6 strings required for the installation

**Total LEDs:** 1200 LEDs (200 LEDs × 6 strings)

**Important Notes:**
- 20m strings are pushing the limit when only injecting power from one end
- Software current limiting is required to avoid incorrect colors at the far end of the string
- This is a trade-off between fewer string connections and power distribution challenges
- Wire appearance: would look better if wire were painted black, but such a product doesn't exist off-the-shelf
- Wire stretching: the wire will stretch during/after installation, and especially with temperature gradients in long-term installations. Consider a re-tensioning concept or better securing method for permanent installations

#### MDF Base

The base houses all electronics and provides structural support:

- **Construction:** Two pieces of 40×40cm MDF + battens screwed together
- **Finish:** Painted black
- **Features:**
  - Houses Raspberry Pi 4, controller PCB, power supply
  - Covered by PLA honeycomb grills for visual cover and ventilation
  - 2× Noctua 40×40mm fans in the back for airflow
  - Cable access holes

### 3D Printed Parts

All 3D model files (.3mf format) are included in this directory. CAD source files are available on Onshape (links below).

#### Base Corner Connector

**File:** `base.3mf`

**Onshape CAD:** [View on Onshape](https://cad.onshape.com/documents/e40c83297a2b759d68be7f6e/w/c118c41bf27f27ad78296554/e/638a71450e9c66e4a3123774?renderMode=0&uiState=6956ac10f4ffcb48da3f94d7)

**Quantity:** 1

**Purpose:** Holds three carbon fiber pipes at the bottom of the cube and secures them to the MDF base plate.

**Features:**
- Secured to base with 4× M5 screws
- Cable routing hole for LED wires

**Print Settings:**
- Material: PETG (recommended for strength)
- Layer height: 0.2mm
- Perimeter walls: 4+ for strength

**Assembly Notes:**
- This is a high-stress part - the 1m CF tubes create significant leverage
- While PETG prints work, aluminum parts would be more durable for permanent installations
- Handle the cube carefully to avoid breaking this part
- Print spare/replacement parts

---

#### Corner Connector

**File:** `corner.3mf`

**Onshape CAD:** [View on Onshape](https://cad.onshape.com/documents/e40c83297a2b759d68be7f6e/w/c118c41bf27f27ad78296554/e/c4481eaa0fdde92928e6f618?renderMode=0&uiState=6956ac18f4ffcb48da3f953c)

**Quantity:** 7 (one for each corner of the cube, except base)

**Purpose:** Connects 3 carbon fiber pipes at 90° angles to form cube corners.

**Print Settings:**
- Material: PETG
- Layer height: 0.2mm
- Shells/perimeters: 4+
- Orientation: Place on corner point for symmetric print

**Assembly Notes:**
- Friction fit design: pipes press into the connector
- Tolerances may vary: be prepared to file, sand, or heat-form for proper fit
- If fit is too loose: wrap electrical tape around CF tube end before inserting
- For permanent installations: consider adding set screws to secure tubes
- Not verified for prolonged thermal cycling (sun, seasons, etc.)

---

#### Cable Management Comb

**File:** `comb.3mf`

**Onshape CAD:** [View on Onshape](https://cad.onshape.com/documents/e40c83297a2b759d68be7f6e/w/c118c41bf27f27ad78296554/e/f5acbb86f4773182431e6e56?renderMode=0&uiState=6956ac02f4ffcb48da3f94a1)

**Quantity:** 60 total (5 per 1m CF pipe × 12 pipes)

**Purpose:** Guides and organizes LED string wires along the carbon fiber tubes.

**Attachment:** Zip ties

**Print Settings:**
- Material: PLA (no significant structural load)
- Layer height: 0.2mm

**Assembly Notes:**
- Attach with small zip ties to CF tubes
- Route LED wires through the comb teeth

---

#### Controller PCB Mount

**File:** `controller_mount.3mf` and `controller_clamp.3mf`

**Onshape CAD:** [View on Onshape](https://cad.onshape.com/documents/70f768b329ba066f39a94f12/w/328bc72038fa8f24f8fcde96/e/15a5e0a3f1c87c68c4469b0a?renderMode=0&uiState=6956ac7726f810cdc954450d)

**Quantity:** 1

**Purpose:** Provides solid base for the controller PCB and strain relief for LED cables.

**Features:**
- Screw mounting points for PCB (M3 threaded inserts required)
- Cable clamps for LED string wire management

**Print Settings:**
- Material: PLA or PETG
- Draft settings acceptable (fast print)
- May not need top/bottom solid layers (just perimeters)

**Assembly Notes:**
- Install M3 threaded inserts (heat-set recommended)
- Secure PCB with M3 screws
- Route LED cables through clamps before connecting to PCB


## License

3D models are licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)
