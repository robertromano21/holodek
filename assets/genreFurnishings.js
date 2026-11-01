(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GenreFurnishings = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const ROLES = ['storage','workstation','seat','light','barrier','transport','device','display',
    'sleeping','food','medical','communication','research','craft'];
  // Each row chooses actual silhouettes, not the same medieval furniture recolored.
  const THEMES = {
    fantasy: ['ironbound_chest','alchemy_bench','high_chair','lantern_post','timber_fence','handcart','well_winch','banner_rack'],
    'dark-fantasy': ['bone_coffer','embalming_table','throne','candelabrum','iron_cage','hearse','reliquary','shrine_screen'],
    mythic: ['amphora_rack','sculptor_bench','stone_bench','tripod_brazier','marble_balustrade','chariot','orrery','votive_stela'],
    'sci-fi': ['cargo_locker','engineering_console','crash_couch','strip_light','pressure_barrier','cargo_loader','reactor_coil','hologram_projector'],
    cyberpunk: ['server_rack','deck_station','capsule_bunk','neon_pylon','security_bollards','delivery_drone','power_junction','advert_screen'],
    'post-apocalyptic': ['scrap_cache','salvage_bench','patched_seat','barrel_lamp','scrap_barricade','wreck_cart','water_filter','warning_board'],
    steampunk: ['brass_cabinet','machinist_bench','leather_chair','arc_pole','gear_gate','steam_trolley','piston_engine','gauge_bank'],
    western: ['supply_crates','smith_anvil','saloon_chair','oil_lamp','hitching_rail','covered_wagon','wind_pump','wanted_board'],
    modern: ['filing_cabinet','office_desk','waiting_bench','street_light','traffic_barrier','utility_cart','transformer','information_kiosk'],
    noir: ['evidence_cabinet','detective_desk','club_chair','deco_lamp','wrought_gate','freight_cart','radio_set','notice_board'],
    nautical: ['sea_chest','sailmakers_table','deck_bench','ship_lantern','rope_rail','dinghy','capstan','chart_table'],
    'cosmic-horror': ['sealed_casket','ritual_table','crooked_throne','eye_lantern','rib_fence','drowned_cart','resonator','forbidden_stela'],
    'gothic-horror': ['coffin_rack','anatomist_table','carved_throne','candle_tree','cemetery_gate','funeral_carriage','pipe_organ','stained_screen'],
    solarpunk: ['seed_bank','repair_table','garden_bench','solar_lamp','living_trellis','pedal_cart','rain_collector','community_board'],
    dieselpunk: ['munition_locker','engine_bench','crew_bench','floodlight','tank_barrier','tracked_trolley','diesel_generator','signal_panel'],
    underwater: ['pressure_locker','dive_console','bubble_seat','reef_lamp','pressure_gate','submersible','oxygen_manifold','sonar_array'],
    prehistoric: ['woven_baskets','flint_table','hide_seat','fire_tripod','thorn_fence','drag_sled','drying_rack','painted_stones'],
    'desert-fantasy': ['ceramic_jars','mosaic_workbench','cushioned_divan','pierced_lantern','lattice_screen','caravan_cart','waterwheel','star_chart']
  };
  const DAILY = {
    fantasy: ['canopied_bed','hearth_oven','herbalist_cot','courier_pigeon_roost','armillary_table','weavers_loom'],
    'dark-fantasy': ['mourning_bed','communal_cauldron','bone_surgery_cot','tolling_bell','sealed_specimen_case','relic_carving_bench'],
    mythic: ['reclining_couch','communal_bread_oven','physicians_cot','herald_gong','bronze_astrolabe','potters_wheel'],
    'sci-fi': ['cryogenic_pod','ration_dispenser','medical_scanner_bed','communications_dish','specimen_microscope','fabrication_printer'],
    cyberpunk: ['stacked_capsule_bunks','street_food_stall','implant_surgery_chair','pirate_uplink','neural_analysis_rig','electronics_rework_bench'],
    'post-apocalyptic': ['shelter_bunk','salvaged_field_stove','field_medic_cot','hand_crank_radio_mast','sample_testing_bench','scrap_press'],
    steampunk: ['railway_sleeper_bunk','steam_kitchen_range','mechanical_surgery_cot','pneumatic_post_terminal','brass_telescope','belt_driven_lathe'],
    western: ['bunkhouse_bed','chuckwagon_stove','country_doctors_cot','telegraph_desk','assayers_balance','leatherworking_frame'],
    modern: ['apartment_bed','canteen_counter','examination_bed','public_telephone','laboratory_microscope','workshop_lathe'],
    noir: ['boarding_house_bed','diner_griddle','backroom_clinic_cot','switchboard','photographic_darkroom','printing_press'],
    nautical: ['sailors_hammock','galley_stove','ships_surgeon_cot','signal_flag_rack','navigation_sextant','ropewalk_frame'],
    'cosmic-horror': ['restraint_couch','sealed_communal_stove','observation_cot','distorted_radio_mast','impossible_telescope','inscribed_press'],
    'gothic-horror': ['four_poster_bed','manor_kitchen_range','infirmary_cot','chapel_bell','antiquarian_specimen_case','restoration_frame'],
    solarpunk: ['woven_sleeping_pod','community_solar_oven','neighborhood_clinic_cot','community_mesh_terminal','ecology_sample_rig','recycled_material_printer'],
    dieselpunk: ['crew_bunk','field_kitchen_range','mobile_surgery_cot','wireless_mast','optical_rangefinder','engine_lathe'],
    underwater: ['pressure_sleeping_pod','algae_culture_dispenser','hyperbaric_medical_pod','acoustic_communications_array','marine_specimen_tank','pressure_workbench'],
    prehistoric: ['hide_sleeping_platform','stone_hearth','healers_hide_cot','message_drum','seasonal_observation_stones','flint_knapping_frame'],
    'desert-fantasy': ['shaded_divan_bed','clay_bread_oven','herbalists_cot','caravan_signal_mirror','astronomers_astrolabe','pattern_weaving_loom']
  };
  for (const [genre, names] of Object.entries(DAILY)) THEMES[genre].push(...names);
  const DETAIL_ROLES=['table','bookshelf','wardrobe','basin','altar','stage','noticeboard','tools','wares','planter','vessel','instrument'];
  const DETAILS={
    fantasy:['trestle_dining_table','illuminated_bookcase','carved_oak_armoire','copper_washstand','votive_altar','timber_players_stage','guild_contract_board','smiths_tool_rack','cloth_and_spice_counter','herb_window_box','glazed_pitchers','standing_harp'],
    'dark-fantasy':['ossuary_refectory_table','chained_memory_bookcase','mourning_robe_armoire','black_marble_washstand','remembrance_altar','shadow_players_dais','oath_notice_board','relic_carvers_tools','wax_and_relic_counter','pale_fern_urn','sealed_ink_jars','bellows_reed_organ'],
    mythic:['stone_banquet_table','scroll_pigeonholes','cedar_clothing_chest','marble_lustral_basin','libation_altar','orators_dais','civic_petition_stela','bronze_artisans_tools','amphora_produce_counter','laurel_terracotta_planter','painted_libation_vessels','bronze_string_lyre'],
    'sci-fi':['foldout_mess_table','data_cartridge_archive','crew_suit_locker','sonic_hygiene_basin','contemplation_memorial','modular_performance_platform','assignment_terminal','engineering_tool_wall','supply_sample_counter','hydroponic_growth_tray','sealed_sample_flasks','electronic_sound_console'],
    cyberpunk:['noodle_shop_table','encrypted_data_stack','streetwear_locker','recycled_water_sink','neighborhood_memorial','club_performance_riser','courier_job_terminal','implant_tool_wall','chip_and_cable_counter','neon_hydroponic_planter','synthdrink_bottles','club_synthesizer'],
    'post-apocalyptic':['reclaimed_dining_table','salvaged_manual_bookcase','patched_gear_cabinet','handpump_washstand','scrap_memorial','reclaimed_players_stage','settlement_work_board','scavengers_tool_wall','salvage_parts_counter','reclaimed_crop_tub','reused_glass_jars','scrap_string_instrument'],
    steampunk:['brass_inlay_dining_table','patent_scroll_cabinet','traveling_coat_armoire','brass_plumbed_washstand','civic_clock_memorial','mechanical_players_stage','pneumatic_assignment_board','machinists_tool_wall','precision_parts_counter','glasshouse_fern_planter','brass_pressure_flasks','pneumatic_pipe_organ'],
    western:['bunkhouse_dining_table','town_ledger_bookcase','saddle_and_coat_cabinet','porcelain_washstand','community_memorial','saloon_players_stage','depot_work_board','ranch_tool_rack','dry_goods_counter','porch_herb_planter','stoneware_jugs','upright_saloon_piano'],
    modern:['canteen_dining_table','public_library_bookcase','staff_clothing_locker','ceramic_washbasin','civic_memorial','community_performance_stage','employment_noticeboard','maintenance_tool_wall','retail_sample_counter','indoor_tree_planter','reusable_drink_bottles','upright_rehearsal_piano'],
    noir:['diner_booth_table','case_file_bookcase','boarding_house_armoire','enameled_washstand','neighborhood_memorial','jazz_club_stage','union_work_board','print_workers_tool_rack','pawn_display_counter','courtyard_fern_planter','soda_and_ink_bottles','club_upright_piano'],
    nautical:['ships_mess_table','chart_folio_bookcase','sailors_gear_locker','ships_washstand','mariners_votive_altar','quayside_players_stage','harbor_assignment_board','riggers_tool_rack','chandlers_supply_counter','salt_garden_planter','stoneware_rum_jugs','sailors_string_fiddle'],
    'cosmic-horror':['crooked_refectory_table','sealed_folio_bookcase','weathered_coat_armoire','green_stone_washstand','silent_votive_altar','pale_players_stage','mariners_missing_noticeboard','antiquarians_tool_rack','curiosity_sample_counter','night_fern_planter','clouded_specimen_jars','dissonant_reed_organ'],
    'gothic-horror':['carved_refectory_table','antiquarian_bookcase','manor_clothing_armoire','carved_stone_washstand','chapel_votive_altar','opera_rehearsal_dais','parish_work_board','restorers_tool_rack','apothecary_display_counter','manor_ivy_planter','etched_tonic_bottles','chamber_pipe_organ'],
    solarpunk:['communal_bamboo_table','open_knowledge_bookcase','woven_clothing_cabinet','reed_filtered_washstand','community_reflection_altar','garden_performance_stage','cooperative_task_board','repair_coop_tool_wall','seed_exchange_counter','living_food_planter','refill_glass_bottles','community_string_harp'],
    dieselpunk:['shift_canteen_table','technical_manual_cabinet','factory_gear_locker','industrial_washbasin','workers_memorial','newsreel_performance_stage','union_shift_board','motor_workers_tool_wall','machine_parts_counter','workers_garden_planter','metal_sample_canisters','broadcast_sound_console'],
    underwater:['anchored_mess_table','sealed_folio_archive','dive_suit_locker','closed_loop_washbasin','ocean_remembrance_altar','acoustic_performance_dais','habitat_assignment_terminal','dive_tool_wall','pressure_parts_counter','marine_culture_planter','pressure_sample_flasks','acoustic_sound_console'],
    prehistoric:['communal_log_table','story_token_rack','woven_hide_gear_rack','stone_wash_basin','ancestor_offering_stone','storytellers_earth_dais','message_token_post','flint_and_bone_tool_rack','woven_produce_counter','herb_growing_basket','clay_storage_pots','hide_message_drum'],
    'desert-fantasy':['low_mosaic_dining_table','astronomers_bookcase','carved_cedar_armoire','tiled_courtyard_washstand','star_votive_altar','courtyard_players_stage','caravan_work_board','tile_makers_tool_rack','spice_and_textile_counter','shaded_citrus_planter','glazed_caravan_jars','carved_string_oud']
  };
  ROLES.push(...DETAIL_ROLES);
  for(const [genre,names]of Object.entries(DETAILS))THEMES[genre].push(...names);
  const SHAPES = Object.fromEntries(Object.entries(THEMES).flatMap(([genre, names]) => names.map((label, i) => [
    `f_${genre}_${ROLES[i]}`, { genre, role: ROLES[i], label: label.replace(/_/g, ' '), model: label,
      furnishing: true, cotg: ['fantasy','dark-fantasy','mythic'].includes(genre), footprint: [1,1], height: i === 3 || i === 6 ? 2.5 : 1.4 }
  ])));
  const has = id => Object.hasOwn(SHAPES, id);
  // Actual metres, converted to cells at placement. A chair is not a 3.5-metre-wide building prop.
  const DIMENSIONS={seat:[.75,.75,1.1],table:[2.2,1.1,.8],sleeping:[1.3,2.1,1.25],storage:[1.4,.65,1.8],
    workstation:[1.8,.8,1.4],food:[2,.9,1.5],medical:[1,2.2,1.6],bookshelf:[1.5,.4,2],wardrobe:[1.3,.65,2],
    basin:[1,.65,1],altar:[1.8,1,1.2],stage:[4,3,.6],noticeboard:[1.3,.4,1.8],tools:[1.4,.5,1.7],
    wares:[1.8,.9,1.2],planter:[1,.8,1.3],vessel:[.7,.5,.65],instrument:[1.4,.7,1.5],craft:[2,1,1.5]};
  function dimensions(id){const info=SHAPES[id];return info?(DIMENSIONS[info.role]||[1.2,.8,1.8]).slice():null;}
  function build(id, size = 24) {
    const info = SHAPES[id];
    if (!info || !Number.isInteger(size) || size < 8 || size > 64) return null;
    const v = new Uint8Array(size ** 3), { model, role,genre } = info;
    const tech=['sci-fi','cyberpunk','underwater'].includes(genre),organic=['prehistoric','solarpunk'].includes(genre);
    const box = (x,y,z,a,b,c,on=1) => {
      for(let k=Math.max(0,Math.floor(z*size));k<Math.min(size,Math.ceil(c*size));k++)
        for(let j=Math.max(0,Math.floor(y*size));j<Math.min(size,Math.ceil(b*size));j++)
          for(let i=Math.max(0,Math.floor(x*size));i<Math.min(size,Math.ceil(a*size));i++)v[i+j*size+k*size*size]=on;
    };
    const cylinder = (x,y,r,z0,z1,on=1) => {
      for(let z=Math.floor(z0*size);z<Math.min(size,Math.ceil(z1*size));z++)
        for(let yy=0;yy<size;yy++)for(let xx=0;xx<size;xx++)
          if(Math.hypot((xx+.5)/size-x,(yy+.5)/size-y)<=r)v[xx+yy*size+z*size*size]=on;
    };
    const feet = (height=.42) => { for(const x of [.12,.78])for(const y of [.2,.73])box(x,y,0,x+.1,y+.1,height); };
    const legs = (height=.5) => { feet(height);box(.08,.15,height,.92,.87,height+.1); };
    const wheels = () => { for(const x of [.08,.83])for(const y of [.24,.67])box(x,y,.02,x+.09,y+.18,.3); };
    if(role==='table') {
      if(tech){box(.25,.3,0,.75,.7,.12);box(.43,.42,.12,.57,.58,.68);box(.06,.12,.68,.94,.88,.79);box(.2,.25,.79,.8,.75,.82);}
      else if(organic){for(const x of[.2,.72])cylinder(x,.5,.13,0,.65);for(const y of[.22,.43,.64])box(.05,y,.65,.95,y+.18,.78);}
      else{legs(.65);if(/mosaic|inlay/.test(model))for(const x of[.2,.4,.6])box(x,.3,.75,x+.1,.7,.78);}
    } else if(role==='bookshelf') {
      for(const x of[.08,.86])box(x,.24,0,x+.06,.85,1);
      for(const z of[.05,.35,.65,.94])box(.08,.24,z,.92,.85,z+.05);
      for(const z of[.1,.4,.7])for(let x=.17;x<.85;x+=.12)box(x,.3,z,x+.07,.68,z+.18+(x% .2));
      if(/data|cartridge|stack/.test(model))box(.13,.73,.08,.87,.85,.93);
      if(tech){box(.04,.2,0,.96,.9,.09);box(.04,.2,.9,.96,.9,1);box(.26,.11,.68,.74,.25,.86);}
      if(genre==='prehistoric'){box(.08,.24,.4,.92,.85,.64,0);for(const x of[.2,.5,.8])cylinder(x,.45,.1,.1,.3);}
    } else if(role==='wardrobe') {
      box(.08,.25,0,.92,.88,.95);box(.12,.18,.08,.88,.27,.89);
      box(.48,.12,.12,.52,.23,.88);for(const x of[.4,.56])box(x,.08,.46,x+.04,.2,.55);
      if(/rack|hide/.test(model)){box(.18,.1,.16,.82,.9,.85,0);box(.12,.45,.84,.88,.55,.91);}
      if(tech){box(.28,.12,.68,.72,.23,.86);box(.22,.31,.89,.78,.81,.96,0);}
    } else if(role==='basin') {
      box(.28,.25,0,.72,.78,.63);box(.08,.12,.63,.92,.86,.86);box(.19,.22,.71,.81,.76,.9,0);
      if(genre!=='prehistoric'){box(.65,.7,.86,.73,.78,1);box(.44,.7,.94,.73,.78,1);}
      if(tech){box(.12,.78,.86,.88,.92,.98);for(const x of[.26,.68])box(x,.7,.9,x+.06,.8,.98);}
    } else if(role==='altar') {
      box(.06,.12,0,.94,.88,.12);box(.2,.26,.12,.8,.74,.7);box(.08,.16,.7,.92,.84,.82);
      if(tech){box(.2,.68,.82,.8,.8,1);box(.25,.64,.86,.75,.68,.96);}
      else{for(const x of[.22,.72])cylinder(x,.5,.06,.82,.99);box(.43,.4,.82,.57,.6,.92);}
    } else if(role==='stage') {
      if(tech){cylinder(.5,.52,.45,0,.65);cylinder(.5,.52,.47,.65,.78);}
      else box(.05,.15,0,.95,.95,.8);
      box(.25,0,0,.75,.15,.28);box(.25,.07,.28,.75,.25,.52);
      for(const x of[.07,.88])box(x,.86,.8,x+.05,.92,1);
    } else if(role==='noticeboard') {
      if(tech){box(.25,.3,0,.75,.8,.09);box(.43,.45,.09,.57,.6,.53);box(.05,.38,.4,.95,.65,.97);box(.12,.31,.48,.88,.39,.9);}
      else{for(const x of[.15,.77])box(x,.44,0,x+.08,.6,.7);box(.06,.35,.4,.94,.68,.97);
        box(.13,.28,.48,.87,.36,.9);for(const x of[.2,.44,.68])box(x,.24,.56,x+.13,.28,.82);}
    } else if(role==='tools') {
      box(.08,.55,.07,.92,.7,.98);box(.04,.2,0,.96,.85,.08);
      for(const x of[.22,.43,.64,.8]){box(x,.4,.3,x+.04,.57,.85);box(x-.06,.36,.78,x+.1,.53,.85);}
      if(tech){box(.06,.2,.08,.25,.55,.24);box(.13,.3,.24,.23,.4,.68);box(.18,.3,.6,.48,.4,.7);}
    } else if(role==='wares') {
      legs(.45);for(const x of[.2,.46,.72]){box(x,.22,.55,x+.15,.45,.75);cylinder(x+.07,.65,.08,.55,.83);}
      if(/counter/.test(model))box(.12,.74,.55,.9,.86,.95);
      if(tech)box(.62,.62,.95,.86,.84,1);
    } else if(role==='planter') {
      box(.15,.18,0,.85,.84,.34);box(.1,.13,.3,.9,.89,.4);
      for(const [x,y]of[[.3,.35],[.6,.6],[.4,.7]]){box(x,y,.4,x+.05,y+.05,.9);for(const z of[.55,.72,.85])box(x-.13,y-.09,z,x+.17,y+.13,z+.05);}
      if(tech){for(const x of[.07,.86])box(x,.1,.34,x+.07,.9,.95);box(.07,.1,.95,.93,.9,1);}
    } else if(role==='vessel') {
      for(const [x,y,r]of[[.25,.4,.17],[.68,.6,.21]]){cylinder(x,y,r,.03,.6);cylinder(x,y,r*.55,.6,.9);cylinder(x,y,r*.7,.87,.96);cylinder(x,y,r*.35,.87,1,0);}
      if(tech)for(const [x,y]of[[.25,.4],[.68,.6]]){box(x-.13,y-.13,.92,x+.13,y+.13,1);box(x-.12,y-.12,.48,x+.12,y+.12,.56);}
    } else if(role==='instrument') {
      if(/console|piano|organ/.test(model)){legs(.3);box(.12,.55,.4,.88,.87,.96);box(.08,.15,.4,.92,.55,.52);for(let x=.2;x<.8;x+=.1)box(x,.23,.52,x+.035,.5,.56);}
      else if(/drum/.test(model)){cylinder(.5,.5,.33,.05,.8);cylinder(.5,.5,.36,.78,.86);}
      else{box(.14,.25,0,.86,.75,.1);box(.18,.4,.1,.27,.6,.96);box(.7,.4,.1,.8,.6,.96);box(.18,.4,.89,.8,.6,1);for(let x=.32;x<.7;x+=.07)box(x,.48,.1,x+.02,.52,.94);}
    } else if(role==='storage') {
      if(/jar|amphora|basket/.test(model)) {
        for(const x of [.25,.72]) { cylinder(x,.5,.2,.05,.55);cylinder(x,.5,.12,.55,.72);cylinder(x,.5,.07,.6,.75,0); }
      } else if(/rack|locker|cabinet|bank/.test(model)) {
        box(.12,.2,0,.88,.85,.95);box(.18,.12,.06,.82,.22,.9);
        for(const z of [.23,.5,.77]) { box(.2,.08,z,.8,.2,z+.04);box(.68,.04,z+.08,.76,.12,z+.13); }
        if(/coffin|bone/.test(model))for(const x of [.25,.7])box(x,.08,.08,x+.06,.2,.88);
      } else {
        box(.08,.2,.05,.92,.83,.58);box(.05,.17,.58,.95,.86,.68);
        for(const x of [.22,.7])box(x,.16,.06,x+.06,.87,.67);box(.46,.1,.35,.55,.2,.52);
      }
    } else if(role==='workstation') {
      if(/console|deck_station/.test(model)) {
        box(.12,.25,0,.88,.8,.5);box(.08,.57,.5,.92,.8,.95);box(.17,.5,.58,.83,.57,.85);
        box(.12,.12,.45,.88,.57,.53);for(const x of [.2,.4,.6])box(x,.2,.53,x+.1,.3,.57);
      } else if(/anvil/.test(model)) {
        box(.3,.28,0,.7,.72,.48);box(.2,.2,.48,.8,.8,.67);box(.04,.38,.6,.96,.62,.76);box(.25,.28,.76,.75,.72,.85);
      } else {
        legs(.5);if(/desk|bench/.test(model))box(.64,.24,.08,.88,.8,.5);
        if(/alchemy|ritual|anatomist|embalm/.test(model)) { cylinder(.25,.5,.1,.6,.83);box(.55,.35,.6,.8,.6,.68); }
        if(/machinist|engine|repair|salvage/.test(model)) { box(.15,.6,.6,.48,.8,.86);cylinder(.65,.45,.13,.6,.72); }
        if(/mosaic|flint|sculptor/.test(model))box(.4,.4,.6,.65,.66,.8);
      }
    } else if(role==='seat') {
      feet(.3);box(.1,.18,.3,.9,.83,.43);
      if(/couch|capsule|bubble|divan/.test(model)) {
        box(.1,.66,.43,.9,.86,.74);for(const x of [.08,.81])box(x,.16,.4,x+.11,.8,.65);
        if(/capsule|bubble/.test(model))box(.07,.15,.78,.93,.87,.9);
      } else { box(.12,.72,.43,.88,.85,/throne/.test(model)?1:.82);if(/throne|club|leather/.test(model))for(const x of [.1,.79])box(x,.23,.43,x+.11,.75,.64); }
    } else if(role==='light') {
      cylinder(.5,.5,.18,0,.09);box(.45,.45,.09,.55,.55,.8);
      if(/strip|solar|flood/.test(model)) {box(.1,.36,.8,.9,.64,.89);box(.15,.3,.81,.85,.36,.86);}
      else if(/candle|candel/.test(model))for(const x of [.2,.5,.8]){box(x-.035,.46,.64,x+.035,.54,.97);box(.18,.47,.64,.82,.53,.7);}
      else {box(.29,.29,.68,.71,.71,.9);box(.24,.24,.9,.76,.76,.96);box(.4,.4,.96,.6,.6,1);}
    } else if(role==='barrier') {
      if(/pressure|security|traffic|tank/.test(model)) {
        for(const x of [.08,.76])box(x,.36,0,x+.16,.64,.83);
        box(.08,.4,.5,.92,.6,.72);box(.15,.42,.72,.85,.58,.82);
      } else {
        for(const x of [.08,.82])box(x,.4,0,x+.1,.6,1);
        for(const z of [.3,.7])box(.08,.43,z,.92,.57,z+.07);
        for(let x=.22;x<.82;x+=.15)box(x,.46,.15,x+.05,.54,.92);
        if(/lattice|trellis|rib/.test(model))for(const z of [.2,.45,.7])box(.15,.4,z,.85,.6,z+.035);
      }
    } else if(role==='transport') {
      wheels();box(.12,.18,.25,.88,.87,.4);
      if(/drone|submersible/.test(model)) {
        box(.22,.22,.4,.78,.78,.72);for(const x of [.06,.8]){box(x,.4,.4,x+.14,.6,.55);cylinder(x+.07,.5,.16,.56,.6);}
        box(.38,.33,.72,.62,.67,.87);
      } else if(/wagon|hearse|carriage/.test(model)) {
        box(.15,.22,.4,.85,.8,.78);box(.1,.16,.78,.9,.86,.91);box(.3,.15,.5,.7,.24,.7,0);box(.42,0,.25,.58,.2,.32);
      } else {box(.14,.66,.4,.86,.84,.7);for(const x of [.14,.78])box(x,.1,.32,x+.08,.7,.4);}
    } else if(role==='device') {
      if(/coil|reactor|generator|piston|engine|transformer/.test(model)) {
        box(.12,.15,0,.88,.85,.15);for(const x of [.3,.68]){cylinder(x,.5,.15,.15,.8);for(const z of [.25,.45,.65])cylinder(x,.5,.2,z,z+.05);}
        box(.23,.4,.82,.78,.6,.91);
      } else if(/pump|waterwheel|winch|capstan/.test(model)) {
        box(.2,.2,0,.8,.8,.16);box(.43,.43,.16,.57,.57,.9);for(const x of [.15,.75])box(x,.4,.5,x+.1,.6,.66);box(.14,.43,.85,.86,.57,.92);
      } else if(/organ|rack|manifold/.test(model)) {
        box(.1,.3,0,.9,.8,.2);for(let x=.16;x<.9;x+=.15)cylinder(x,.5,.055,.2,.55+x*.4);
      } else {
        box(.2,.2,0,.8,.8,.15);for(const x of [.25,.65])box(x,.35,.15,x+.1,.65,.75);box(.2,.28,.75,.8,.72,.85);cylinder(.5,.5,.15,.2,.65);
      }
    } else if(role==='sleeping') {
      feet(.22);box(.1,.15,.22,.9,.86,.34);box(.15,.2,.34,.85,.79,.43);box(.2,.64,.43,.8,.78,.52);
      if(/pod|capsule/.test(model)){for(const x of[.08,.84])box(x,.12,.28,x+.08,.9,.84);box(.08,.12,.84,.92,.9,.95);box(.18,.15,.54,.82,.2,.77);}
      else if(/hammock/.test(model)){for(const y of[.1,.83])box(.45,y,0,.55,y+.08,.95);box(.15,.3,.44,.85,.7,.5);}
      else if(/bunk/.test(model)){for(const x of[.1,.82])for(const y of[.15,.8])box(x,y,0,x+.08,y+.08,.98);box(.1,.15,.73,.9,.88,.81);}
      else if(/poster|canop/.test(model)){for(const x of[.1,.82])for(const y of[.15,.8])box(x,y,0,x+.08,y+.08,1);box(.08,.12,.94,.92,.9,1);}
    } else if(role==='food') {
      box(.12,.2,.04,.88,.84,.58);box(.08,.15,.58,.92,.88,.68);
      if(/dispenser|counter|stall/.test(model)){box(.15,.65,.68,.85,.86,.98);box(.32,.58,.72,.68,.65,.87);box(.18,.12,.42,.82,.38,.5);}
      else if(/cauldron/.test(model)){cylinder(.5,.5,.33,.15,.7);cylinder(.5,.5,.25,.48,.75,0);for(const x of[.08,.82])box(x,.42,.42,x+.1,.58,.63);}
      else{box(.38,.15,.18,.66,.22,.46,0);for(const x of[.3,.7])cylinder(x,.47,.12,.68,.73);box(.72,.65,.68,.87,.8,1);}
    } else if(role==='medical') {
      legs(.38);box(.12,.18,.48,.88,.82,.59);box(.2,.66,.59,.8,.8,.72);
      if(/scanner|pod|chair/.test(model)){for(const x of[.08,.84])box(x,.3,.48,x+.08,.7,.92);box(.08,.3,.92,.92,.7,1);box(.73,.08,.65,.92,.25,.84);}
      else{box(.08,.74,.5,.16,.86,.96);box(.02,.68,.84,.23,.92,.9);}
    } else if(role==='communication') {
      box(.2,.25,0,.8,.78,.18);
      if(/desk|terminal|switchboard|telephone/.test(model)){box(.15,.2,.18,.85,.8,.6);box(.16,.63,.6,.84,.82,.92);for(const x of[.25,.5,.75])box(x,.57,.67,x+.07,.63,.75);}
      else if(/bell|gong|drum/.test(model)){for(const x of[.12,.8])box(x,.4,0,x+.08,.6,1);box(.12,.4,.92,.88,.6,1);cylinder(.5,.5,.22,.52,.86);cylinder(.5,.5,.16,.5,.66,0);}
      else{box(.45,.45,.18,.55,.55,1);for(const z of[.4,.7,.9])box(.12,.45,z,.88,.55,z+.05);box(.25,.3,.65,.75,.7,.74);}
    } else if(role==='research') {
      legs(.4);
      if(/tank|case/.test(model)){box(.2,.25,.5,.8,.75,.57);for(const x of[.2,.74])for(const y of[.25,.69])box(x,y,.57,x+.06,y+.06,.95);box(.2,.25,.95,.8,.75,1);cylinder(.5,.5,.12,.57,.9);}
      else{box(.45,.45,.5,.55,.55,.92);box(.25,.35,.83,.76,.65,.94);cylinder(.7,.5,.16,.77,.98);box(.25,.3,.53,.5,.7,.59);}
    } else if(role==='craft') {
      legs(.33);
      if(/loom|frame|ropewalk/.test(model)){for(const x of[.14,.78])box(x,.2,.43,x+.08,.8,1);box(.14,.2,.92,.86,.8,1);for(let x=.26;x<.78;x+=.1)box(x,.45,.43,x+.03,.55,.94);}
      else if(/printer|press/.test(model)){for(const x of[.15,.77])box(x,.2,.43,x+.08,.82,.94);box(.15,.2,.94,.85,.82,1);box(.43,.42,.55,.57,.58,.94);box(.24,.3,.43,.76,.75,.5);}
      else{box(.17,.4,.43,.83,.7,.62);for(const x of[.25,.65])cylinder(x,.55,.15,.62,.78);box(.6,.55,.78,.75,.72,.96);}
    } else if(role==='display') {
      if(/hologram|sonar/.test(model)) {
        cylinder(.5,.5,.32,0,.2);for(const x of [.22,.72])box(x,.46,.2,x+.06,.54,.82);box(.25,.45,.82,.75,.55,.88);
      } else {
        for(const x of [.23,.69])box(x,.46,0,x+.08,.54,.55);
        box(.1,.38,.4,.9,.62,.96);box(.18,.32,.48,.82,.4,.86);
        if(/banner|shrine|stained/.test(model))box(.06,.35,.94,.94,.65,1);
        if(/gauge|radio|signal/.test(model))for(const x of [.25,.5,.75])cylinder(x,.34,.07,.55,.62);
      }
    }
    return v;
  }
  function color(id,x,y,z,normal,palette){
    const info=SHAPES[id];if(!info||!DETAIL_ROLES.includes(info.role))return null;
    const {role,genre}=info,p=palette||['#8a6544','#50483f','#dccaaa','#211d1b','#c7a47f','#7cb5b3'];
    let hex=p[z>.7?2:0];
    if(role==='planter'&&z>.4)hex=genre==='underwater'?'#59c9b9':genre==='dark-fantasy'?'#9aa788':'#629d54';
    if(role==='bookshelf'&&z>.1&&z<.9&&y<.72)hex=['#785447','#436a77','#b6a477','#637b56'][Math.floor(x*24)%4];
    if(role==='tools'&&y<.58)hex=p[2];
    if(role==='noticeboard'&&z>.5&&z<.88&&y<.4)hex=['sci-fi','cyberpunk','underwater'].includes(genre)?p[5]:'#d9cca0';
    if(role==='vessel')hex=z>.48&&z<.56?p[2]:p[1];
    const shade=normal[2]>.5?1.04:normal[0]+normal[1]>0?.9:.72;
    return[1,3,5].map(i=>Math.min(1,parseInt(hex.slice(i,i+2),16)/255*shade));
  }
  return { ROLES, THEMES, DAILY, DETAILS, DETAIL_ROLES, SHAPES, DIMENSIONS, dimensions, has, build,color };
});
