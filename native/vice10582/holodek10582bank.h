// SPDX-License-Identifier: GPL-2.0-or-later
// Native VSID demonstration of the private HDKSV001 multi-chip register score.
// Not PSID, not a 6502 speech driver, and never a PCM/sample-file player.
#ifndef HOLODEK_10582_BANK_H
#define HOLODEK_10582_BANK_H
#include "holodek10582.h"
#include <vector>
#include <fstream>
#include <string>
class Holodek10582Bank{
    std::vector<unsigned char> bytes;
    std::vector<Holodek10582> chips;
    unsigned rate,hz,ticks,samples,fade,position,tick,offset,nextTick,events;
    double gain,dx,dy,countdown,cyclesPerSample;
    unsigned u16(unsigned n)const{return bytes[n]|(bytes[n+1]<<8);}
    unsigned u32(unsigned n)const{return u16(n)|(u16(n+2)<<16);}
    double f64(unsigned n)const{double x;std::memcpy(&x,&bytes[n],8);return x;}
    unsigned edge(unsigned n)const{return unsigned(std::floor(n*double(rate)/hz+.5));}
    double sample(){
        if(position>=samples)return 0;
        if(position==nextTick){
            unsigned count=u16(offset);offset+=2;
            for(unsigned n=0;n<count;n++,offset+=3){unsigned index=u16(offset);chips[index>>6].write(index&63,bytes[offset+2]);}
            nextTick=edge(++tick);for(unsigned n=0;n<chips.size();n++)chips[n].beginTick(nextTick-position);
        }
        float raw=0;const double g=.5/std::sqrt(double(chips.size()));
        for(unsigned n=0;n<chips.size();n++)raw=float(raw+chips[n].rawSample()*g);
        double y=raw-dx+.995*dy;dx=raw;dy=y;float value=float(y);
        if(fade){unsigned k=std::min(position,samples-1-position);if(k<fade){double f=std::sin(1.5707963267948966*k/fade);value=float(value*f*f);}}
        position++;return std::max(-.98,std::min(.98,value*gain));
    }
public:
    bool load(const char *file,int outputRate,int hostClock,std::string &error){
        std::ifstream in(file,std::ios::binary|std::ios::ate);if(!in){error="Cannot open voice register score";return false;}
        std::streamoff size=in.tellg();if(size<80||size>24*1024*1024){error="Invalid voice score size";return false;}
        bytes.resize(size_t(size));in.seekg(0);in.read(reinterpret_cast<char*>(&bytes[0]),size);if(!in){error="Cannot read voice score";return false;}
        if(std::memcmp(&bytes[0],"HDKSV001",8)||u16(8)!=80||u16(10)!=10582||u16(14)!=1){error="Expected exact-timed 10582 HDKSV001 score";return false;}
        unsigned count=u16(12),clock=u32(20),scale=u16(24);rate=u32(16);hz=u16(26);ticks=u32(28);samples=u32(32);fade=u32(36);gain=f64(40);events=u32(56);
        if(count<1||count>64||(rate!=22050&&rate!=44100)||outputRate!=int(rate)||(scale!=1&&scale!=2&&scale!=4)||clock!=985248*scale||hz<100||hz>8000||!ticks||ticks>120*hz||samples!=edge(ticks)||samples>120*rate||fade>samples/4||!std::isfinite(gain)||gain<0||gain>6||f64(48)!=.995||u32(60)+80!=bytes.size()){
            error="Invalid voice score parameters or mismatched output sample rate";return false;
        }
        unsigned at=80,total=0;for(unsigned n=0;n<ticks;n++){
            if(at+2>bytes.size()){error="Truncated voice tick";return false;}unsigned writes=u16(at);at+=2;
            if(at+writes*3>bytes.size()){error="Truncated voice registers";return false;}
            for(unsigned j=0;j<writes;j++,at+=3)if(u16(at)>=count*64){error="Voice chip index out of range";return false;}total+=writes;
        }
        if(at!=bytes.size()||total!=events){error="Voice score length mismatch";return false;}
        chips.resize(count);for(unsigned n=0;n<count;n++)chips[n].configure(rate,clock,scale);
        cyclesPerSample=double(hostClock)/rate;reset();return true;
    }
    void reset(){for(unsigned n=0;n<chips.size();n++)chips[n].reset();position=tick=nextTick=0;offset=80;dx=dy=0;countdown=cyclesPerSample;}
    int clock(int &cycles,short *out,int count,int interleave){
        int n=0;while(cycles>0&&n<count){int take=std::min(cycles,std::max(1,int(std::ceil(countdown))));cycles-=take;countdown-=take;
            if(countdown<=0){out[n*interleave]=short(std::round(sample()*32767));n++;countdown+=cyclesPerSample;}}
        return n;
    }
    unsigned chipCount()const{return unsigned(chips.size());}
    unsigned eventCount()const{return events;}
};
#endif
