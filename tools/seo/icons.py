from PIL import Image, ImageDraw, ImageFont
BG=(10,10,15); CY=(79,214,232); RED=(255,90,95); INK=(236,232,222); MUT=(156,153,168)
def ring(size, rounded=False):
    k=8; N=size*k; im=Image.new("RGBA",(N,N),(0,0,0,0)); d=ImageDraw.Draw(im)
    if rounded: d.rounded_rectangle([0,0,N-1,N-1],radius=N*14/64,fill=BG)
    else: d.rectangle([0,0,N,N],fill=BG)
    c=N/2; ro=N*17.5/64; ri=N*10.5/64
    d.ellipse([c-ro,c-ro,c+ro,c+ro],fill=CY); d.ellipse([c-ri,c-ri,c+ri,c+ri],fill=BG)
    return im.resize((size,size),Image.LANCZOS)
for n,name in [(96,"favicon-96.png"),(180,"apple-touch-icon.png"),(192,"icon-192.png"),(512,"icon-512.png")]:
    ring(n).convert("RGB").save(name)
ring(256,True).save("favicon.ico",sizes=[(16,16),(32,32),(48,48)])
# social card (run from public/)
W,H=1200,630; k=2; im=Image.new("RGB",(W*k,H*k),BG); d=ImageDraw.Draw(im)
S="/System/Library/Fonts/Supplemental/"
big=ImageFont.truetype(S+"STIXTwoText.ttf",150*k); bigi=ImageFont.truetype(S+"STIXTwoText-Italic.ttf",150*k)
small=ImageFont.truetype(S+"STIXTwoText.ttf",36*k)
parts=[("amog",big,INK),(".",big,RED),("fun",bigi,CY)]
ws=[d.textlength(t,font=f) for t,f,_ in parts]; ringw=150*k; gap=50*k
total=ringw+gap+sum(ws); x=(W*k-total)/2; base=330*k
c=(x+ringw/2, base-48*k); ro=75*k; ri=45*k
d.ellipse([c[0]-ro,c[1]-ro,c[0]+ro,c[1]+ro],fill=CY); d.ellipse([c[0]-ri,c[1]-ri,c[0]+ri,c[1]+ri],fill=BG)
x+=ringw+gap
for (t,f,col),w in zip(parts,ws): d.text((x,base),t,font=f,fill=col,anchor="ls"); x+=w
sub="Math games from the Magnussen Institute for Applied Fun"
d.text((W*k/2,base+95*k),sub,font=small,fill=MUT,anchor="ms")
im.resize((W,H),Image.LANCZOS).save("og.png",optimize=True)
