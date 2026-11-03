'use strict';
const Flags=require('./worldFlags'),C=require('./generationContracts'),Work=require('./holodekRoomWork'),E=require('../assets/cityEstablishments');
const DISTRICTS=['gate','market','temple','residential','guild','harbor','undercity'];
const FORMS=['organic','grid','ring','single'];
const Life=require('./cityLife');
const normalized=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
function distinctName(name,qualifier,used,max){
  const original=String(name||'').trim().replace(/\s+/g,' ');if(!original)throw Error('A city location needs an authored name.');
  if(!used.has(normalized(original)))return original;
  // Repeated brands and place names are legal; the saved district/function makes their address unambiguous.
  for(let n=1;n<100;n++){
    const suffix=' / '+qualifier+(n===1?'':' '+n),candidate=original+suffix;
    if(!used.has(normalized(candidate)))return candidate;
  }
  throw Error('City location address space exhausted.');
}
function compileDistrict(raw,{id,required,accepted}){
  const districts=Object.values(accepted),usedDistricts=new Set(districts.map(d=>normalized(d.name)));
  const name=distinctName(raw.name,id,usedDistricts,70),used=new Set(districts.flatMap(d=>d.locales.map(l=>normalized(l.name))));
  const {venues,...rest}=raw,locales=required.map(type=>{
    const authoredName=venues?.[type];if(typeof authoredName!=='string'||!authoredName.trim())throw Error('Author one name for each required venue function.');
    const label=distinctName(authoredName,`${name} ${type}`,used,65);used.add(normalized(label));
    return{name:label,type,...(label!==authoredName?{authoredName}:{} )};
  });
  return{...rest,name,...(name!==raw.name?{authoredName:raw.name}:{}),locales};
}
function validate(design){
  if(design?.version!==1||!FORMS.includes(design.form)||!design.identity?.trim()||!design.history?.trim()||!design.skyline?.trim())throw Error('City identity, history, skyline and approved form are required.');
  if(design.verticality)require('./cityVerticality').validate(design.verticality);
  const names=new Set(),locales=new Set();
  for(const id of DISTRICTS){const d=design.districts?.[id];
    if(!d?.name?.trim()||!d.atmosphere?.trim()||!Array.isArray(d.locales)||d.locales.length<2||d.locales.length>3||names.has(d.name.toLowerCase()))throw Error('Missing or repeated city district: '+id);
    names.add(d.name.toLowerCase());
    if(d.locales.some(l=>!E.TYPES.includes(l.type)||!l.name?.trim())||!d.mix?.length||d.mix.some(t=>!E.TYPES.includes(t)))throw Error('Unapproved city establishment in '+id);
    if(design.venueProgram===1&&Life.required(id,design.scale).some(type=>!d.locales.some(l=>l.type===type)))throw Error('Missing city venue function in '+id);
    for(const l of d.locales){const name=l.name.trim().toLowerCase();if(locales.has(name))throw Error('Repeated major city locale: '+l.name);locales.add(name);}
  }
  return design;
}
async function ensure($,room,{seed='',world=require('./settingLayer').current(),ecology=world?.ecology}={}){
  const site=room?.environmentIntent?.citySite;
  if(!Flags.on('CITY_SITES')||!Flags.on('CITY_COMPLETE')||!Flags.on('ARCHITECTURE_EXPANSION')||!site||room.cityRoom||room.citySites||room.sceneSpec||room.visited)return{status:'skipped'};
  if(site.design){validate(site.design);return{status:'saved'};}
  const genre=require('../assets/genreKits').resolve(room,world).genre,local=require('./graveMasterStoryPrompts').isHolodek1();
  const worldFacts=world?(local?{name:world.name,genres:world.genres,realm:world.realm,ecology:world.wilds,history:String(world.history||'').slice(0,600),arc:world.arc}:world):
    {campaign:'Children of the Grave',region:site.region,city:site.name,history:'Underworld souls form real communities in Tartarus. Hades remains Mortacia\'s fallen city under Arithus. Preserve the canonical campaign, deities and actual city allegiance; no god is spawned by city planning.'};
  const scale=require('../assets/urbanDesigns').scale(site,genre);
  const context={city:{id:site.id,name:site.name,role:site.role,allegiance:site.allegiance,population:site.population,scale,genre,utilities:site.utilities},world:worldFacts,
    architecture:require('../assets/cityArchitectureStyles').brief(genre,!world)};
  const rules='CITY AUTHORING, not a gameplay turn. Invent a distinctive lived-in city and varied local lives, not a fixed maintenance problem. Preserve the supplied city identity, location, allegiance and campaign. No new inhabitants are spawned, no quest is begun or completed, no inventory, rewards, gates or coordinates change. Investigation and random encounters may later develop side jobs through the existing quest engine. Establishment types are approved mechanical roles, not mandatory names; use original names and this world\'s technology, peoples, history and currency. Future scenarios may have enormous vertical or horizontal scale. ';
  const identity=await Work.request($,'city-identity',{identity:C.nonblankText(400),history:C.nonblankText(600),skyline:C.nonblankText(240),form:C.choice(FORMS),enclosed:Boolean,verticality:require('./cityVerticality').schema(C)},
    rules+'Author the city-wide identity, history, skyline, broad street form and verticality. enclosed is true for a city inside a pressure habitat, station, submarine dome or continuous cave roof: its public gardens and streets cannot open onto vacuum, deep water or solid rock. Outdoor planetary cities may be open. Large medieval/Renaissance city-states require hundreds of believable buildings across connected wards, not a village; modern/future capitals can exceed that footprint and extend upward. Mix everyday frontages with large institutions, streets, freight access and public spaces at human scale. Modern and future metropolises need genuine skyscraper districts, typically dozens of floors, stacked uses, transit and plausible upper connections, not a flat village with tall decoration. Medieval and god-built underworld capitals may also have monumental towers, terraced citadels and elevated ways. Choose scale from this specific setting, not a genre ceiling; small settlements should remain small. verticality.floors is the tallest representative occupied tower, not a demand that every building be that tall. Give distinct lower, middle, upper and crown uses; stairs/ramps/lifts must fit the technology or established powers. Every tower floor gets a saved address and purpose; interiors and named residents are authored only when entered, never invented as already met. Facts: '+JSON.stringify(context));
  const design={version:1,source:'model-authored',venueProgram:1,scale,seed,genre,...identity,districts:{}};
  const Art=require('../assets/cityArchitectureStyles');
  if(Art.profile(genre,!world).heritage)design.architecture={version:1,tradition:Art.tradition(identity,seed),source:'authored-identity-and-seed'};
  for(const id of DISTRICTS){
    const required=Life.required(id,scale);
    const district=await Work.request($,'city-district',{
      name:C.nonblankText(70),atmosphere:C.nonblankText(300),
      residentRoles:{type:[C.nonblankText(65)],minItems:2,maxItems:4},
      venues:Object.fromEntries(required.map(type=>[type,C.nonblankText(65)])),
      mix:{type:[C.choice(E.TYPES)],minItems:2,maxItems:4}
    },rules+Life.brief(genre,!world)+' Author only district role '+id+'. It is a broad role, not an obligatory cult or occupation. In venues, give one memorable original name for each supplied functional property: '+JSON.stringify(required)+'. The engine compiles these named properties into individual locations, so do not return a free-form locale array or rename the property keys. Supply a fitting procedural establishment mix. Adapt names, customs, materials and activities to this world; a mechanical temple role may be a secular contemplation institution, never a forced foreign religion. Each locale is a real planned venue, not a decorative promise. Distinguish it from already accepted districts. City facts: '+JSON.stringify(context)+'. Authored city identity: '+JSON.stringify(identity)+'. Accepted districts and venues: '+JSON.stringify(Object.values(design.districts).map(d=>({name:d.name,locales:d.locales}))),raw=>{
      return compileDistrict(raw,{id,required,accepted:design.districts});
    });
    design.districts[id]=district;
  }
  if(ecology){
    require('./settingEcology').validate(ecology);
    const ids=ecology.entries.map(e=>e.id);
    const mix=await Work.request($,'city-population-percentages',{
      originalPercent:ecology.canonical?{type:Number,minimum:5,maximum:95,multipleOf:1}:{type:Number,enum:[0]},
      weights:{type:C.list({id:C.choice(ids),weight:{type:Number,minimum:0,maximum:100,multipleOf:1}}),minItems:ids.length,maxItems:ids.length}
    },rules+'Set the city population percentages by giving a relative weight for EVERY saved ecology group ID exactly once. Zero may exclude a group locally, but total must be positive. Keep the table\'s creatures and peoples, do not substitute prefabs. Ordinary inhabitants should be numerous; spread major cast/quest contacts across their existing authored locations, never move or duplicate them. '+
      (ecology.canonical?'Retain both new CotG groups AND the original D&D-style catalog, with originalPercent 5-95. ':'originalPercent must be 0. ')+
      'City identity: '+JSON.stringify(identity)+'. Saved ecology: '+JSON.stringify(ecology.entries.map(e=>({id:e.id,name:e.name,kind:e.kind,habitat:e.habitat,allegiance:e.allegiance}))),raw=>{
        if(new Set(raw.weights.map(r=>r.id)).size!==ids.length||raw.weights.some(r=>!ids.includes(r.id))||!raw.weights.some(r=>r.weight>0))throw Error('Provide one population weight per saved ecology group, with positive total.');return raw;
      });
    design.populationMix={...mix,percentages:require('./settingEcology').percentages(mix.weights)};
  }
  validate(design);
  // Commit a complete plan to this anchor only; never mutate the shared campaign atlas mid-build.
  room.environmentIntent.citySite={...site,design};
  console.info('[CityAuthoring]',JSON.stringify({cityId:site.id,genre,status:'compiled',districts:DISTRICTS.length,authoredLocales:Object.values(design.districts).reduce((n,d)=>n+d.locales.length,0)}));
  return{status:'authored',design};
}
module.exports={DISTRICTS,FORMS,validate,ensure,compileDistrict};
