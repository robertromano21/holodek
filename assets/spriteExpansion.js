(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SpriteExpansion=api;})(typeof window==='object'?window:globalThis,function(root){
'use strict';
// Original additive archetypes; exact keywords keep existing compound names unchanged.
const CATALOG={
  "fantasy": {
    "creatures": [
      {
        "key": "fernstag",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "horns": "antlers",
          "tail": "thick",
          "c": "#8caa70",
          "c2": "#506140"
        }
      },
      {
        "key": "copperbadger",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "size": "small",
          "mark": "stripes",
          "tail": "thick",
          "c": "#b4875d",
          "c2": "#674d35"
        }
      },
      {
        "key": "mosskin",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "bark",
          "ears": "pointed",
          "mark": "cracks",
          "hairC": "#517344",
          "c": "#6c8a52",
          "c2": "#3e4f2f"
        }
      },
      {
        "key": "petalwing",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "wings": "insect",
          "ears": "pointed",
          "size": "small",
          "c": "#c5af84",
          "c2": "#70644b"
        }
      }
    ],
    "roles": [
      {
        "key": "waywarden",
        "style": "leather",
        "weapon": "spear"
      },
      {
        "key": "hedgehealer",
        "style": "leather",
        "weapon": "staff"
      },
      {
        "key": "relicbearer",
        "style": "leather",
        "weapon": "lantern"
      },
      {
        "key": "guildmessenger",
        "style": "leather",
        "weapon": "dagger"
      }
    ],
    "pieces": [
      "quilted_surcoat",
      "travel_coif",
      "herb_wallet",
      "woven_girdle"
    ]
  },
  "dark-fantasy": {
    "creatures": [
      {
        "key": "ossuarybrute",
        "def": {
          "plan": [
            "skeletal",
            6
          ],
          "head": "skull",
          "covering": "bone",
          "outfitHint": "plate",
          "eye": "#a0dfbc",
          "eyeGlow": true,
          "c": "#c3b89d",
          "c2": "#6f6959"
        }
      },
      {
        "key": "mourninghart",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "horns": "antlers",
          "tail": "thick",
          "c": "#62536d",
          "c2": "#382f3e"
        }
      },
      {
        "key": "cinderveil",
        "def": {
          "plan": [
            "spectral",
            6
          ],
          "floating": true,
          "tattered": true,
          "translucency": 0.35,
          "eyeGlow": true,
          "c": "#a999b5",
          "c2": "#605767"
        }
      },
      {
        "key": "thornbound",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "bark",
          "ears": "pointed",
          "mark": "cracks",
          "hairC": "#517344",
          "c": "#7f7757",
          "c2": "#484432"
        }
      }
    ],
    "roles": [
      {
        "key": "ashconfessor",
        "style": "robe",
        "weapon": "staff"
      },
      {
        "key": "cryptwarden",
        "style": "robe",
        "weapon": "axe"
      },
      {
        "key": "vigilbearer",
        "style": "robe",
        "weapon": "lantern"
      },
      {
        "key": "reliquarist",
        "style": "robe",
        "weapon": "tome"
      }
    ],
    "pieces": [
      "funeral_stole",
      "vigil_coif",
      "reliquary_case",
      "knotted_cord"
    ]
  },
  "mythic": {
    "creatures": [
      {
        "key": "amberaurochs",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "covering": "fur",
          "horns": "ram",
          "tusks": true,
          "build": "heavy",
          "c": "#b58b57",
          "c2": "#674f32"
        }
      },
      {
        "key": "laurelkin",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "ears": "pointed",
          "hair": "braid",
          "c": "#d5b78c",
          "c2": "#796850"
        }
      },
      {
        "key": "ivoryibis",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "head": "bird",
          "wings": "feather",
          "covering": "feathers",
          "c": "#e0d9bc",
          "c2": "#807c6b"
        }
      },
      {
        "key": "marbleward",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "stone",
          "head": "eyeless",
          "mark": "cracks",
          "build": "heavy",
          "c": "#ccc8c1",
          "c2": "#74726e"
        }
      }
    ],
    "roles": [
      {
        "key": "votivekeeper",
        "style": "tabard",
        "weapon": "staff"
      },
      {
        "key": "oathlancer",
        "style": "tabard",
        "weapon": "spear"
      },
      {
        "key": "templeherald",
        "style": "tabard",
        "weapon": "banner"
      },
      {
        "key": "sacredrunner",
        "style": "tabard",
        "weapon": "dagger"
      }
    ],
    "pieces": [
      "pleated_mantle",
      "bronze_fillet",
      "votive_disc",
      "braided_sash"
    ]
  },
  "western": {
    "creatures": [
      {
        "key": "pronghorn",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "horns": "curved",
          "tail": "thick",
          "c": "#bb9b6d",
          "c2": "#6b583e"
        }
      },
      {
        "key": "prairiebadger",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "size": "small",
          "mark": "stripes",
          "tail": "thick",
          "c": "#8d877b",
          "c2": "#504d46"
        }
      },
      {
        "key": "rangemustang",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "covering": "fur",
          "ears": "long",
          "mane": true,
          "tail": "thick",
          "c": "#996742",
          "c2": "#573b26"
        }
      },
      {
        "key": "trailmule",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "covering": "fur",
          "ears": "long",
          "mane": true,
          "tail": "thick",
          "c": "#918574",
          "c2": "#534c42"
        }
      }
    ],
    "roles": [
      {
        "key": "trailmarshal",
        "style": "leather",
        "weapon": "pistol"
      },
      {
        "key": "telegrapher",
        "style": "leather",
        "weapon": "scanner"
      },
      {
        "key": "stagecoachman",
        "style": "leather",
        "weapon": "rifle"
      },
      {
        "key": "rangeveterinarian",
        "style": "leather",
        "weapon": "lantern"
      }
    ],
    "pieces": [
      "trail_waistcoat",
      "creased_hat",
      "dispatch_pouch",
      "cartridge_sash"
    ]
  },
  "sci-fi": {
    "creatures": [
      {
        "key": "surveywalker",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "metal",
          "head": "eyeless",
          "eye": "#a0dfef",
          "eyeGlow": true,
          "c": "#a7b9c6",
          "c2": "#5f6971"
        }
      },
      {
        "key": "ceramicunit",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "metal",
          "head": "human",
          "eye": "#a0dfef",
          "eyeGlow": true,
          "c": "#d8d5c7",
          "c2": "#7b7971"
        }
      },
      {
        "key": "prismcrawler",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "metal",
          "eyes": 4,
          "eye": "#a4ded7",
          "eyeGlow": true,
          "c": "#738ba8",
          "c2": "#424f60"
        }
      },
      {
        "key": "nebularay",
        "def": {
          "plan": [
            "serpent",
            6
          ],
          "head": "reptile",
          "covering": "crystal",
          "tail": "scaled",
          "c": "#879acc",
          "c2": "#4d5874"
        }
      }
    ],
    "roles": [
      {
        "key": "xenobiologist",
        "style": "leather",
        "weapon": "scanner"
      },
      {
        "key": "voidsurveyor",
        "style": "leather",
        "weapon": "rifle"
      },
      {
        "key": "orbitalrigger",
        "style": "leather",
        "weapon": "hammer"
      },
      {
        "key": "beaconoperator",
        "style": "leather",
        "weapon": "pistol"
      }
    ],
    "pieces": [
      "segmented_vest",
      "survey_visor",
      "signal_array",
      "modular_harness"
    ]
  },
  "cyberpunk": {
    "creatures": [
      {
        "key": "relayhound",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "metal",
          "tail": "thin",
          "eye": "#c9a8e7",
          "eyeGlow": true,
          "c": "#78728a",
          "c2": "#44414f"
        }
      },
      {
        "key": "chromemantis",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "metal",
          "head": "insect",
          "eye": "#a0dfef",
          "eyeGlow": true,
          "c": "#74978e",
          "c2": "#425651",
          "extraArms": 1
        }
      },
      {
        "key": "wireback",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "metal",
          "eyes": 4,
          "eye": "#a4ded7",
          "eyeGlow": true,
          "c": "#80708f",
          "c2": "#494052"
        }
      },
      {
        "key": "latticeunit",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "metal",
          "head": "eyeless",
          "eye": "#a0dfef",
          "eyeGlow": true,
          "c": "#ada1be",
          "c2": "#635c6c"
        }
      }
    ],
    "roles": [
      {
        "key": "signalbroker",
        "style": "leather",
        "weapon": "scanner"
      },
      {
        "key": "implanttech",
        "style": "leather",
        "weapon": "dagger"
      },
      {
        "key": "gridcourier",
        "style": "leather",
        "weapon": "pistol"
      },
      {
        "key": "switchguard",
        "style": "leather",
        "weapon": "rifle"
      }
    ],
    "pieces": [
      "circuit_bolero",
      "fiber_band",
      "relay_node",
      "port_harness"
    ]
  },
  "post-apocalyptic": {
    "creatures": [
      {
        "key": "scrapjackal",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "tail": "thick",
          "mark": "spots",
          "c": "#ae986e",
          "c2": "#63573f"
        }
      },
      {
        "key": "dustcarapace",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "chitin",
          "eyes": 4,
          "c": "#aa8e5b",
          "c2": "#615134"
        }
      },
      {
        "key": "saltgrazer",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "covering": "fur",
          "horns": "ram",
          "tusks": true,
          "build": "heavy",
          "c": "#c2b092",
          "c2": "#6f6453"
        }
      },
      {
        "key": "siltmutant",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "mark": "veins",
          "tattered": true,
          "c": "#9eaa7b",
          "c2": "#5a6146"
        }
      }
    ],
    "roles": [
      {
        "key": "cisternkeeper",
        "style": "rags",
        "weapon": "spear"
      },
      {
        "key": "scrapsurgeon",
        "style": "rags",
        "weapon": "dagger"
      },
      {
        "key": "convoyoutrider",
        "style": "rags",
        "weapon": "rifle"
      },
      {
        "key": "salvagehauler",
        "style": "rags",
        "weapon": "hammer"
      }
    ],
    "pieces": [
      "patchwork_vest",
      "filter_wrap",
      "water_flask",
      "salvage_strap"
    ]
  },
  "steampunk": {
    "creatures": [
      {
        "key": "bellowsbeetle",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "metal",
          "eyes": 4,
          "eye": "#a4ded7",
          "eyeGlow": true,
          "c": "#b89151",
          "c2": "#69532e"
        }
      },
      {
        "key": "brassbadger",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "metal",
          "tail": "thin",
          "eye": "#c9a8e7",
          "eyeGlow": true,
          "c": "#bf9c62",
          "c2": "#6d5938"
        }
      },
      {
        "key": "porcelainpage",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "metal",
          "head": "human",
          "eye": "#a0dfef",
          "eyeGlow": true,
          "c": "#ded3bd",
          "c2": "#7f786c"
        }
      },
      {
        "key": "coppercoil",
        "def": {
          "plan": [
            "serpent",
            6
          ],
          "covering": "metal",
          "head": "reptile",
          "c": "#b18352",
          "c2": "#654b2f"
        }
      }
    ],
    "roles": [
      {
        "key": "boilerminder",
        "style": "leather",
        "weapon": "hammer"
      },
      {
        "key": "pneumaticpostman",
        "style": "leather",
        "weapon": "pistol"
      },
      {
        "key": "escapementmaker",
        "style": "leather",
        "weapon": "scanner"
      },
      {
        "key": "aerostatpilot",
        "style": "leather",
        "weapon": "rifle"
      }
    ],
    "pieces": [
      "riveted_waistcoat",
      "pressure_goggles",
      "gauge_cluster",
      "valve_belt"
    ]
  },
  "modern": {
    "creatures": [
      {
        "key": "rescuecollie",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "tail": "thick",
          "mark": "spots",
          "c": "#b99d78",
          "c2": "#695944"
        }
      },
      {
        "key": "urbanbadger",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "size": "small",
          "mark": "stripes",
          "tail": "thick",
          "c": "#9a958a",
          "c2": "#58554f"
        }
      },
      {
        "key": "parkdeer",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "horns": "antlers",
          "tail": "thick",
          "c": "#b3956c",
          "c2": "#66553e"
        }
      },
      {
        "key": "canalotter",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "size": "small",
          "mark": "none",
          "tail": "thin",
          "c": "#a28a69",
          "c2": "#5c4f3c"
        }
      }
    ],
    "roles": [
      {
        "key": "fieldparamedic",
        "style": "leather",
        "weapon": "lantern"
      },
      {
        "key": "utilityworker",
        "style": "leather",
        "weapon": "hammer"
      },
      {
        "key": "parksranger",
        "style": "leather",
        "weapon": "scanner"
      },
      {
        "key": "newsreporter",
        "style": "leather",
        "weapon": "scanner"
      }
    ],
    "pieces": [
      "field_jacket",
      "service_cap",
      "medical_pouch",
      "work_webbing"
    ]
  },
  "noir": {
    "creatures": [
      {
        "key": "dockterrier",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "tail": "thick",
          "mark": "spots",
          "c": "#b2a287",
          "c2": "#655c4d"
        }
      },
      {
        "key": "alleyferret",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "size": "small",
          "mark": "none",
          "tail": "thin",
          "c": "#b7aa93",
          "c2": "#686154"
        }
      },
      {
        "key": "rainhound",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "tail": "thick",
          "mark": "spots",
          "c": "#7a8087",
          "c2": "#46494d"
        }
      },
      {
        "key": "cellarrat",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "size": "small",
          "mark": "none",
          "tail": "thin",
          "c": "#8c7e6b",
          "c2": "#50483d"
        }
      }
    ],
    "roles": [
      {
        "key": "nightporter",
        "style": "leather",
        "weapon": "lantern"
      },
      {
        "key": "courtreporter",
        "style": "leather",
        "weapon": "scanner"
      },
      {
        "key": "dockinspector",
        "style": "leather",
        "weapon": "pistol"
      },
      {
        "key": "privateoperative",
        "style": "leather",
        "weapon": "pistol"
      }
    ],
    "pieces": [
      "pinstriped_waistcoat",
      "rain_brim",
      "evidence_case",
      "document_strap"
    ]
  },
  "nautical": {
    "creatures": [
      {
        "key": "tideboar",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "covering": "fur",
          "horns": "none",
          "tusks": true,
          "build": "heavy",
          "c": "#9c8d70",
          "c2": "#595040"
        }
      },
      {
        "key": "saltotter",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "size": "small",
          "mark": "none",
          "tail": "thin",
          "c": "#a49d87",
          "c2": "#5d594d"
        }
      },
      {
        "key": "reefadder",
        "def": {
          "plan": [
            "serpent",
            6
          ],
          "head": "reptile",
          "covering": "scales",
          "tail": "scaled",
          "c": "#729e9a",
          "c2": "#415a58"
        }
      },
      {
        "key": "sailback",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "chitin",
          "eyes": 4,
          "c": "#b99877",
          "c2": "#695744"
        }
      }
    ],
    "roles": [
      {
        "key": "tidepilot",
        "style": "leather",
        "weapon": "sword"
      },
      {
        "key": "sailmender",
        "style": "leather",
        "weapon": "dagger"
      },
      {
        "key": "harborwatcher",
        "style": "leather",
        "weapon": "spear"
      },
      {
        "key": "chartkeeper",
        "style": "leather",
        "weapon": "tome"
      }
    ],
    "pieces": [
      "tarred_oilskin",
      "sailors_wrap",
      "chart_tube",
      "rope_harness"
    ]
  },
  "cosmic-horror": {
    "creatures": [
      {
        "key": "brineoracle",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "tentacles": 4,
          "eyeStyle": "slit",
          "floating": true,
          "c": "#87a79e",
          "c2": "#4d5f5a"
        }
      },
      {
        "key": "hushpolyp",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "tentacles": 4,
          "eyeStyle": "slit",
          "floating": true,
          "c": "#a08fb4",
          "c2": "#5b5267"
        }
      },
      {
        "key": "lensbrood",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "chitin",
          "eyes": 4,
          "c": "#8d83a3",
          "c2": "#504b5d"
        }
      },
      {
        "key": "tideless",
        "def": {
          "plan": [
            "spectral",
            6
          ],
          "floating": true,
          "tattered": true,
          "translucency": 0.35,
          "eyeGlow": true,
          "c": "#b0bfc1",
          "c2": "#646d6e"
        }
      }
    ],
    "roles": [
      {
        "key": "tidearchivist",
        "style": "robe",
        "weapon": "tome"
      },
      {
        "key": "signalwatcher",
        "style": "robe",
        "weapon": "scanner"
      },
      {
        "key": "thresholdreader",
        "style": "robe",
        "weapon": "staff"
      },
      {
        "key": "saltinvestigator",
        "style": "robe",
        "weapon": "lantern"
      }
    ],
    "pieces": [
      "ritual_overwrap",
      "listening_cowl",
      "sealed_capsule",
      "talisman_cord"
    ]
  },
  "gothic-horror": {
    "creatures": [
      {
        "key": "belfrygargant",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "stone",
          "wings": "bat",
          "horns": "curved",
          "c": "#97909c",
          "c2": "#565259"
        }
      },
      {
        "key": "palliddoe",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "horns": "antlers",
          "tail": "thick",
          "c": "#ccc8bb",
          "c2": "#74726b"
        }
      },
      {
        "key": "vesperkin",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "fangs": true,
          "ears": "pointed",
          "cape": true,
          "c": "#bba8b0",
          "c2": "#6b6064"
        }
      },
      {
        "key": "shroudbride",
        "def": {
          "plan": [
            "spectral",
            6
          ],
          "floating": true,
          "tattered": true,
          "translucency": 0.35,
          "eyeGlow": true,
          "c": "#c9bacd",
          "c2": "#736a75"
        }
      }
    ],
    "roles": [
      {
        "key": "bellwatcher",
        "style": "robe",
        "weapon": "lantern"
      },
      {
        "key": "shroudweaver",
        "style": "robe",
        "weapon": "dagger"
      },
      {
        "key": "manorphysician",
        "style": "robe",
        "weapon": "tome"
      },
      {
        "key": "candlewarden",
        "style": "robe",
        "weapon": "staff"
      }
    ],
    "pieces": [
      "mourning_mantlet",
      "lace_bonnet",
      "candle_case",
      "silver_clasp"
    ]
  },
  "solarpunk": {
    "creatures": [
      {
        "key": "orchardstag",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "horns": "antlers",
          "tail": "thick",
          "c": "#b4a174",
          "c2": "#675c42"
        }
      },
      {
        "key": "pollenbeetle",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "chitin",
          "eyes": 4,
          "c": "#a3bc71",
          "c2": "#5d6b40"
        }
      },
      {
        "key": "mossbadger",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "size": "small",
          "mark": "stripes",
          "tail": "thick",
          "c": "#91a27f",
          "c2": "#535c48"
        }
      },
      {
        "key": "reedkin",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "ears": "pointed",
          "hair": "braid",
          "c": "#bed1a2",
          "c2": "#6c775c"
        }
      }
    ],
    "roles": [
      {
        "key": "seedlibrarian",
        "style": "leather",
        "weapon": "tome"
      },
      {
        "key": "canopytender",
        "style": "leather",
        "weapon": "staff"
      },
      {
        "key": "watersteward",
        "style": "leather",
        "weapon": "scanner"
      },
      {
        "key": "cellwright",
        "style": "leather",
        "weapon": "hammer"
      }
    ],
    "pieces": [
      "woven_workvest",
      "leaf_brim",
      "sprout_pouch",
      "trellis_belt"
    ]
  },
  "dieselpunk": {
    "creatures": [
      {
        "key": "rivethound",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "metal",
          "tail": "thin",
          "eye": "#c9a8e7",
          "eyeGlow": true,
          "c": "#939c91",
          "c2": "#545953"
        }
      },
      {
        "key": "yardcrawler",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "metal",
          "eyes": 4,
          "eye": "#a4ded7",
          "eyeGlow": true,
          "c": "#97a38c",
          "c2": "#565d50"
        }
      },
      {
        "key": "ironporter",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "metal",
          "head": "eyeless",
          "eye": "#a0dfef",
          "eyeGlow": true,
          "c": "#adb2a1",
          "c2": "#63655c"
        }
      },
      {
        "key": "oiladder",
        "def": {
          "plan": [
            "serpent",
            6
          ],
          "covering": "metal",
          "head": "reptile",
          "c": "#83937d",
          "c2": "#4b5447"
        }
      }
    ],
    "roles": [
      {
        "key": "raildispatcher",
        "style": "leather",
        "weapon": "scanner"
      },
      {
        "key": "enginefitter",
        "style": "leather",
        "weapon": "hammer"
      },
      {
        "key": "airfieldmedic",
        "style": "leather",
        "weapon": "lantern"
      },
      {
        "key": "radiowarden",
        "style": "leather",
        "weapon": "rifle"
      }
    ],
    "pieces": [
      "reinforced_tunic",
      "mechanics_cap",
      "radio_set",
      "gauge_harness"
    ]
  },
  "underwater": {
    "creatures": [
      {
        "key": "coralwarden",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "covering": "scales",
          "ears": "fin",
          "hair": "flowing",
          "c": "#a0cbb7",
          "c2": "#5b7468"
        }
      },
      {
        "key": "pearleel",
        "def": {
          "plan": [
            "serpent",
            6
          ],
          "head": "reptile",
          "covering": "scales",
          "tail": "scaled",
          "c": "#c9dbce",
          "c2": "#737d75"
        }
      },
      {
        "key": "kelpcrab",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "chitin",
          "eyes": 4,
          "c": "#b5bb9c",
          "c2": "#676b59"
        }
      },
      {
        "key": "abyssglider",
        "def": {
          "plan": [
            "serpent",
            6
          ],
          "head": "reptile",
          "covering": "crystal",
          "tail": "scaled",
          "c": "#89b4cc",
          "c2": "#4e6774"
        }
      }
    ],
    "roles": [
      {
        "key": "reefmender",
        "style": "leather",
        "weapon": "spear"
      },
      {
        "key": "currentreader",
        "style": "leather",
        "weapon": "staff"
      },
      {
        "key": "pressurewright",
        "style": "leather",
        "weapon": "hammer"
      },
      {
        "key": "pearlkeeper",
        "style": "leather",
        "weapon": "lantern"
      }
    ],
    "pieces": [
      "ribbed_divevest",
      "shell_crest",
      "sample_canister",
      "pearl_girdle"
    ]
  },
  "prehistoric": {
    "creatures": [
      {
        "key": "flintback",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "covering": "scales",
          "horns": "none",
          "tusks": false,
          "build": "heavy",
          "c": "#a28b63",
          "c2": "#5c4f38",
          "spikes": true,
          "size": "large"
        }
      },
      {
        "key": "tuskram",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "covering": "fur",
          "horns": "ram",
          "tusks": true,
          "build": "heavy",
          "c": "#c1ae91",
          "c2": "#6e6353"
        }
      },
      {
        "key": "ochrehunter",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "ears": "pointed",
          "hair": "braid",
          "c": "#b19471",
          "c2": "#655440"
        }
      },
      {
        "key": "reedstrider",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "head": "bird",
          "wings": "feather",
          "covering": "feathers",
          "c": "#b8ad8c",
          "c2": "#696350"
        }
      }
    ],
    "roles": [
      {
        "key": "flintknapper",
        "style": "furs",
        "weapon": "hammer"
      },
      {
        "key": "hearthkeeper",
        "style": "furs",
        "weapon": "lantern"
      },
      {
        "key": "boneseer",
        "style": "furs",
        "weapon": "staff"
      },
      {
        "key": "trailgatherer",
        "style": "furs",
        "weapon": "spear"
      }
    ],
    "pieces": [
      "sinew_hidevest",
      "bone_headband",
      "flint_pouch",
      "hide_girdle"
    ]
  },
  "desert-fantasy": {
    "creatures": [
      {
        "key": "dunegazelle",
        "def": {
          "plan": [
            "beast",
            5
          ],
          "head": "beast",
          "ears": "animal",
          "covering": "fur",
          "horns": "long",
          "tail": "thick",
          "c": "#ceb187",
          "c2": "#75654d"
        }
      },
      {
        "key": "glassadder",
        "def": {
          "plan": [
            "serpent",
            6
          ],
          "head": "reptile",
          "covering": "crystal",
          "tail": "scaled",
          "c": "#c4d3c6",
          "c2": "#707871"
        }
      },
      {
        "key": "oasisbeetle",
        "def": {
          "plan": [
            "spider",
            6
          ],
          "covering": "chitin",
          "eyes": 4,
          "c": "#cbae75",
          "c2": "#746343"
        }
      },
      {
        "key": "saffronkin",
        "def": {
          "plan": [
            "humanoid",
            5
          ],
          "ears": "pointed",
          "hair": "braid",
          "c": "#d3b28d",
          "c2": "#786550"
        }
      }
    ],
    "roles": [
      {
        "key": "cisternoracle",
        "style": "robe",
        "weapon": "staff"
      },
      {
        "key": "caravanlancer",
        "style": "robe",
        "weapon": "spear"
      },
      {
        "key": "glasswright",
        "style": "robe",
        "weapon": "hammer"
      },
      {
        "key": "oasisphysician",
        "style": "robe",
        "weapon": "tome"
      }
    ],
    "pieces": [
      "wrapped_kaftan",
      "sun_veil",
      "spice_case",
      "tassel_sash"
    ]
  }
};
function allowed(genre){const f=root.HolodekFlags;if(!f||!('HOMEBREW_ACTIVE' in f))return true;return f.HOMEBREW_ACTIVE ? Array.isArray(f.HOMEBREW_GENRES)&&f.HOMEBREW_GENRES.includes(genre) : ['fantasy','dark-fantasy','mythic'].includes(genre);}
const creatures=Object.entries(CATALOG).flatMap(([genre,g])=>g.creatures.map(e=>({...e,genre})));
const roles=Object.entries(CATALOG).flatMap(([genre,g])=>g.roles.map(e=>({...e,genre})));
function find(list,text){const w=String(text||'').toLowerCase().split(/[^a-z]+/);return list.find(e=>allowed(e.genre)&&w.includes(e.key))||null;}
const ROLE_VARIANTS={"fantasy":["flower_crown wrap_robe seed_satchel","deep_cowl tabard scroll_case","feathered_cap leather_jerkin hand_lantern"],"dark-fantasy":["bone_crown bone_armor ritual_dagger","deep_cowl grave_shroud soul_lantern","wimple mourning_dress chain_fetters"],"mythic":["crested_helm lamellar bracers","laurel toga holy_symbol","circlet scale_mail quiver"],"western":["wide_brim vest lamp","headscarf leather_jerkin bandana","straw_hat duster lawman_badge"],"sci-fi":["dome_helmet exo_frame holo_badge","headset pressure_suit air_tank","respirator lab_coat cyber_eye"],"cyberpunk":["glow_visor neon_jacket data_cable","headset tactical_vest cyber_eye","respirator hoodie neon"],"post-apocalyptic":["gasmask rusted_plate gas_canister","goggles sand_robes bandana","headscarf tactical_vest pauldrons"],"steampunk":["bowler frock_coat clockwork_gears","pilot_cap vest pocket_watch","goggles greatcoat goggles"],"modern":["hard_hat flight_jacket medical_pouch","beret tactical_vest lawman_badge","headset jacket press_camera"],"noir":["fedora vest press_camera","bowler trench lawman_badge","flat rain_slicker pocket_watch"],"nautical":["tricorn naval_jacket hand_lantern","bandana frock_coat hand_lantern","feathered_cap rain_slicker hand_lantern"],"cosmic-horror":["flat lab_coat eye","fedora robe_hem tendrils","wraith_halo grave_shroud ritual_dagger"],"gothic-horror":["top frock_coat hand_lantern","wimple mourning_dress soul_lantern","beaked_mask laced_corset chain_fetters"],"solarpunk":["flower_crown vine_wrap seed_satchel","sunhat jacket solar_pack","leaf_brim woven_workvest sprout_pouch"],"dieselpunk":["pilot_cap flight_jacket gas_canister","gasmask trench goggles","hard_hat greatcoat lamp"],"underwater":["diving_helm pressure_suit air_tank","bubble suit_stripe starfish_charm","helmet ribbed_divevest pack"],"prehistoric":["tribal_mask hide_wrap bracers","antler_headdress fur_mantle bone_necklace","feather leather_jerkin quiver"],"desert-fantasy":["veil sand_robes scroll_case","headscarf wrap_robe amulet","turban lamellar spice_case"]};
const ROLE_PALETTES={"fantasy":["#355c3d","#806437","#5d4373","#6c4c35"],"dark-fantasy":["#40374c","#4c4b54","#645344","#4a2d40"],"mythic":["#ad7844","#51627a","#c6bba0","#955247"],"western":["#8e623e","#7b4c3c","#41566a","#8d7d52"],"sci-fi":["#afbfc8","#43627c","#b4a180","#d5d9d5"],"cyberpunk":["#393443","#343a51","#365852","#5b3954"],"post-apocalyptic":["#857550","#776047","#5f6c4b","#64605b"],"steampunk":["#77513b","#8b6740","#436460","#73514d"],"modern":["#33596d","#b8813e","#63826f","#d1d1c6"],"noir":["#4f5059","#6c6262","#464b57","#78654d"],"nautical":["#36576c","#3e5369","#7b674a","#a18e60"],"cosmic-horror":["#3a5658","#615771","#405167","#77765e"],"gothic-horror":["#514455","#70636a","#4d4d5b","#764959"],"solarpunk":["#65814e","#6b985c","#57918d","#ba9b62"],"dieselpunk":["#65715f","#77674d","#7c8790","#4f625e"],"underwater":["#558c8d","#8cb0a0","#6b7c95","#b79d7d"],"prehistoric":["#8b704c","#ad8e63","#9b6a4b","#747e52"],"desert-fantasy":["#bd976a","#8e6650","#638b89","#b6a378"]};
function outfitFor(genre,key){const g=CATALOG[genre],p=g.pieces,i=g.roles.findIndex(e=>e.key===key);const o={genre,coat:p[0],hat:p[1],extra:p[2],belt:p[3]};if(i>0){const [hat,coat,extra]=ROLE_VARIANTS[genre][i-1].split(' ');Object.assign(o,{hat,coat,extra});}return o;}
function paletteFor(role){const i=CATALOG[role.genre].roles.findIndex(e=>e.key===role.key);return ROLE_PALETTES[role.genre][Math.max(0,i)];}
return {CATALOG,creatures,roles,allowed,creatureFor:text=>find(creatures,text),roleFor:text=>find(roles,text),outfitFor,paletteFor};
});
