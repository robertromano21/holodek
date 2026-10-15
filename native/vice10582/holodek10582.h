// SPDX-License-Identifier: GPL-2.0-or-later
// Experimental 10582 register-driven SID model for the separate VICE build.
// Port of retort/sidVoice/jsid.js. No samples, score interpreter or JSON layer.
#ifndef HOLODEK_10582_H
#define HOLODEK_10582_H
#ifdef inline
#undef inline
#endif
#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif
#include <cmath>
#include <cstring>
#include <algorithm>
class Holodek10582 {
    struct Voice { double acc,env,hold; unsigned lfsr; int stage,held; } v[3];
    unsigned char r[64];
    double sr,clk,countdown,lp,bp,fe[3],fy1,fy2,nm,nz[4],dcX,dcY,cutScale;
    bool bankSilent;
    int phase[3],divider;
    static double limit(double x,double a,double b){return std::max(a,std::min(b,x));}
    static double cutoff(int n){
        const double table[][2]={{0,30},{60,389},{100,630},{150,1015},{220,1455},{300,2200},{400,2653},{550,3541},{700,5085},{900,6181},{1100,7877},{1400,8999},{1700,10627},{2047,12000}};
        for(int i=1;i<14;i++)if(n<=table[i][0])return table[i-1][1]+(table[i][1]-table[i-1][1])*(n-table[i-1][0])/(table[i][0]-table[i-1][0]);
        return 12000;
    }
    void envelope(int i,double dt){
        const double times[]={2,8,16,24,38,56,68,80,100,250,500,800,1000,3000,5000,8000};
        Voice &x=v[i];int a=r[i*7+5],s=r[i*7+6];
        if(x.stage==1){x.env+=dt*1000/times[a>>4];if(x.env>=1){x.env=1;x.stage=2;}}
        else if(x.stage==2){double sustain=(s>>4)/15.0;x.env=sustain+(x.env-sustain)*std::exp(-dt*4000/(times[a&15]*3));}
        else if(x.stage==3){x.env*=std::exp(-dt*4000/(times[s&15]*3));if(x.env<.0005){x.env=0;x.stage=0;}}
    }
    double sample(bool raw=false){
        if(raw&&bankSilent)return 0;
        const double pi=3.14159265358979323846,dt=1/sr,inc=clk/sr;
        const int mode=r[24]>>4,route=r[23]&7;
        const int cr=(r[21]&7)|(r[22]<<3);
        const double vol=(r[24]&15)/15.0,fc=std::min(sr*(cutScale>=4?.3:.22),cutoff(cr)*(1+(cutScale-1)*cr/2047)),w=2*std::sin(pi*fc/sr/2),q=1/(.707+(r[23]>>4)/15.0);
        double fin=0,dir=0;bool wrapped[3];
        for(int i=0;i<3;i++){if(!raw)envelope(i,dt);wrapped[i]=v[i].acc+(r[i*7]|(r[i*7+1]<<8))*inc>=16777216;}
        for(int i=0;i<3;i++){
            Voice &x=v[i];const int c=r[i*7+4],wave=c>>4;const double frequency=(r[i*7]|(r[i*7+1]<<8))*inc;
            if(!wave){if(x.env>.0001&&x.held){x.hold=2048+(x.hold-2048)*std::exp(-dt/.8);double y=(x.hold-2048)/2048*x.env;if(route>>i&1)fin+=y;else if(!(i==2&&(mode&8)))dir+=y;}continue;}
            const double previous=x.acc;x.acc=(c&8)?0:std::fmod(x.acc+frequency,16777216);
            if((c&2)&&wrapped[(i+2)%3])x.acc=0;
            double o;
            if(wave&8){if(!(int(previous)&0x80000)&&(int(x.acc)&0x80000)){const unsigned bit=((x.lfsr>>22)^(x.lfsr>>17))&1;x.lfsr=((x.lfsr<<1)|bit)&0x7fffff;}unsigned n=x.lfsr;o=((n>>22&1)<<11)|((n>>20&1)<<10)|((n>>16&1)<<9)|((n>>13&1)<<8)|((n>>11&1)<<7)|((n>>7&1)<<6)|((n>>4&1)<<5)|((n>>2&1)<<4);}
            else if(wave&4){const double threshold=(r[i*7+2]|((r[i*7+3]&15)<<8))*4096.0,a1=previous+frequency;double hi=a1<=16777216?std::max(0.0,a1-std::max(previous,threshold)):std::max(0.0,16777216-std::max(previous,threshold))+std::max(0.0,a1-16777216-threshold);o=(c&8)?(x.acc/4096>=threshold/4096?4095:0):4095*std::min(1.0,hi/std::max(1.0,frequency));}
            else if(wave&2)o=int(x.acc)>>12;
            else{const int msb=(int(x.acc)^((c&4)?int(v[(i+2)%3].acc):0))&0x800000;o=(msb?(~int(x.acc)&0x7fffff):(int(x.acc)&0x7fffff))>>11;}
            double e=x.env;
            if(r[30]>>i&1){if(phase[i]==1){fe[i]+=1/(((r[29]&15)+1)*.0005*sr);if(fe[i]>=1){fe[i]=1;phase[i]=2;}}else if(phase[i]==2){fe[i]*=std::exp(-1/(((r[29]>>4)+1)*.002*sr/2.3));if(fe[i]<.0001){fe[i]=0;phase[i]=0;}}e=fe[i];}
            const double y=(o-2048)/2048*e*((r[28]>>i&1)?0:r[25+i]/255.0);
            if(route>>i&1)fin+=y;else if(!(i==2&&(mode&8)))dir+=y;
        }
        if((r[31]&1)&&!(r[28]&8)&&r[35]){
            const int source=(r[31]>>1)&3,div=((r[31]>>5)&3)+1;
            double excitation=0;if((source==0||source==2)&&wrapped[0]&&++divider>=div){divider=0;excitation=1;}
            if(source>=1)excitation+=((int(v[2].lfsr>>22)&1)-.5)*.25;
            const double hz=std::min(double(r[32]|(r[33]<<8)),sr*.45),bw=std::max(20,int(r[34])*4),radius=std::exp(-pi*bw/sr),angle=2*pi*hz/sr;
            const double y=2*radius*std::cos(angle)*fy1-radius*radius*fy2+(std::sin(angle)?std::sin(angle):.001)*excitation;
            fy2=fy1;fy1=y;const double f=y*r[35]/255.0;if(r[31]&16)fin+=f;else dir+=f;
        }else if(!raw){fy1*=.5;fy2*=.5;}
        double y=0;for(int i=0;i<2;i++){double hp=fin-lp-q*bp;bp+=w*hp;lp+=w*bp;if(i)y=(mode&1?lp:0)+(mode&2?bp:0)+(mode&4?hp:0);}
        y=(y+dir)*vol;
        if((r[36]&1)||nm>0){
            const double hz=limit(r[37]|(r[38]<<8),50,sr*.45),width=std::max(20,int(r[39]|(r[40]<<8))),depth=std::max(.001,r[41]/255.0),A=std::sqrt(depth),omega=2*pi*hz/sr,alpha=std::sin(omega)/(2*hz/width),cs=std::cos(omega),a0=1+alpha/A;
            if(nm==0)for(int i=0;i<4;i++)nz[i]=y;
            const double yo=((1+alpha*A)*y-2*cs*nz[0]+(1-alpha*A)*nz[1]+2*cs*nz[2]-(1-alpha/A)*nz[3])/a0;
            nz[1]=nz[0];nz[0]=y;nz[3]=nz[2];nz[2]=yo;nm=(r[36]&1)?std::min(1.0,nm+1/(.001*sr)):std::max(0.0,nm-1/(.001*sr));y+=(yo-y)*nm;
        }
        if(raw)return y;
        const double dc=y-dcX+std::exp(-2*pi*18/sr)*dcY;dcX=y;dcY=dc;
        return limit(dc*.22,-.98,.98);
    }
public:
    Holodek10582():sr(44100),clk(985248),cutScale(1),bankSilent(false){reset();}
    void configure(int rate,int clock,int scale=1){sr=rate;clk=clock;cutScale=scale;countdown=clk/sr;}
    void beginTick(int samples){
        for(int i=0;i<3;i++)envelope(i,samples/sr);
        bankSilent=!(r[24]&15);
        if(bankSilent){for(int i=0;i<3;i++)v[i].acc=std::fmod(v[i].acc+(r[i*7]|(r[i*7+1]<<8))*clk/sr*samples,16777216);lp*=.9;bp*=.9;}
        else if(!((r[31]&1)&&!(r[28]&8)&&r[35])){fy1*=.5;fy2*=.5;}
    }
    double rawSample(){return sample(true);}
    void reset(){std::memset(r,0,sizeof(r));std::memset(v,0,sizeof(v));std::memset(fe,0,sizeof(fe));std::memset(phase,0,sizeof(phase));std::memset(nz,0,sizeof(nz));for(int i=0;i<3;i++){r[25+i]=255;v[i].lfsr=0x7ffff8;v[i].hold=2048;}lp=bp=fy1=fy2=nm=dcX=dcY=0;divider=0;countdown=clk/sr;}
    void write(unsigned address,unsigned value){
        const unsigned a=address&63,old=r[a];r[a]=(unsigned char)value;
        if(a==30){for(int i=0;i<3;i++)if(value>>(4+i)&1)phase[i]=1;r[30]&=15;}
        if(a<21&&a%7==4){Voice &x=v[a/7];if(value&8){x.acc=0;x.held=1;x.hold=2048;}if((value&1)&&!(old&1))x.stage=1;if(!(value&1)&&(old&1))x.stage=3;}
    }
    unsigned char read(unsigned address)const{const unsigned a=address&63;if(a==27)return (unsigned char)(v[2].env*255);if(a==26)return (unsigned char)(int(v[2].acc)>>16);return r[a];}
    int clock(int &cycles,short *out,int count,int interleave){
        int n=0;while(cycles>0&&n<count){const int take=std::min(cycles,std::max(1,int(std::ceil(countdown))));cycles-=take;countdown-=take;
            if(countdown<=0){out[n*interleave]=(short)(sample()*32767);n++;countdown+=clk/sr;}}
        return n;
    }
};
#endif
