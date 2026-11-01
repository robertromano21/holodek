'use strict';
// Metadata, not a suggestive room name, makes a new population a staffed market.
function market(room, setting) {
  if(room?.cityRoom?.establishmentType)return kind(room)==='shop';
  return setting?.siteKind === 'market' || room?.cityRoom?.district === 'market' ||
    room?.cityRoom?.kind === 'building' && room.cityRoom.service === 'shop' ||
    room?.environmentIntent?.template === 'market' && !!room.environmentIntent.citySite;
}
function kind(room){const type=room?.cityRoom?.establishmentType;return require('../assets/cityEstablishments').servicePlan({type})?.kind||null;}
module.exports = {market,kind};
