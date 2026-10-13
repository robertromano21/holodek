import sys,subprocess,numpy as np
N=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def chroma(path,rate=1.0,start=0,dur=None):
    a=['ffmpeg','-v','error','-i',path]
    af=f'asetrate=22050*{rate},aresample=22050' if rate!=1 else 'anull'
    a+=['-af',af,'-ac','1','-ar','22050','-f','f32le','-']
    x=np.frombuffer(subprocess.run(a,capture_output=True).stdout,dtype=np.float32)
    x=x[int(start*22050):int((start+dur)*22050) if dur else None]
    S=np.abs(np.fft.rfft(x*np.hanning(len(x)))); f=np.fft.rfftfreq(len(x),1/22050)
    c=np.zeros(12); m=(f>50)&(f<2500)
    for fi,s in zip(f[m],S[m]): c[int(round(12*np.log2(fi/440)+69))%12]+=s*s
    c/=c.sum(); o=np.argsort(c)[::-1][:3]; return ' '.join(f'{N[i]}:{c[i]:.2f}' for i in o)
for p,r,lbl in [('amb_drone_A.ogg',1,'drone as rendered (A)'),('amb_drone_A.ogg',2**(-4/12),'drone -> F'),('amb_drip_A.ogg',1,'drip (A)'),('amb_drip_A.ogg',2**(3/12),'drip -> C'),('amb_howl_A.ogg',1,'howl (A)'),('amb_howl_A.ogg',2**(-2/12),'howl -> G')]:
    print(f'{lbl:24s}', chroma(p,r))
