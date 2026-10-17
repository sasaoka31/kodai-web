// Free GDevelop Particles Library(Wishforge)の粒子の設定。scripts/import-gdparticles.py が作る(手で直さない)
//   kind: quad(絵)/ point(点)/ line(線)。dir: 向き(度)、cone: 広がり(度)、f: 速さ(px/秒)、g: 重力(px/秒²)、life: 寿命(秒)、size: 大きさ(% 始め → 終わり)、
//   r: 基準の大きさ(px)、alpha: 濃さ(0〜255 始め → 終わり)、c1 → c2: 色、rot: 回る速さ(度/秒)、zone: 出る範囲の半径、flow: 1秒に出る数、tank: 全部で出る数(-1 = ずっと)
export const GDP_TEXTURES = ["blood1", "blood2", "blood3", "bloodhand", "darkmagicsmoke", "explosionfog_texture_2", "explosiontexture1", "explosiontexture_smoke_1", "glow", "lightning_texture_1", "runes1", "snowflake2", "trail", "water"];
export const GDP = {
 "BadEnergy": {
  "label": "悪い気",
  "kind": "quad",
  "tex": "darkmagicsmoke",
  "add": false,
  "dir": -90,
  "cone": 1,
  "f": [
   0,
   0
  ],
  "g": [
   0,
   0
  ],
  "life": [
   5,
   10
  ],
  "size": [
   0,
   80
  ],
  "r": [
   1,
   1
  ],
  "alpha": [
   0,
   40
  ],
  "c1": [
   0,
   0,
   0
  ],
  "c2": [
   0,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   22,
   33
  ],
  "zone": 30,
  "flow": 2,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "HorrorBloodyHand": {
  "label": "血の手形",
  "kind": "quad",
  "tex": "bloodhand",
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   10,
   20
  ],
  "g": [
   0,
   -2
  ],
  "life": [
   2,
   7
  ],
  "size": [
   0,
   40
  ],
  "r": [
   1,
   1
  ],
  "alpha": [
   0,
   200
  ],
  "c1": [
   255,
   0,
   71
  ],
  "c2": [
   8,
   2,
   20
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   2,
   6
  ],
  "zone": 30,
  "flow": 2,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "VoidEnergy": {
  "label": "虚無の気",
  "kind": "quad",
  "tex": "darkmagicsmoke",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   10,
   20
  ],
  "g": [
   0,
   0
  ],
  "life": [
   3,
   8
  ],
  "size": [
   0,
   100
  ],
  "r": [
   1,
   1
  ],
  "alpha": [
   255,
   0
  ],
  "c1": [
   0,
   0,
   0
  ],
  "c2": [
   63,
   0,
   143
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 30,
  "flow": 4,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "DarkMagicEnergy": {
  "label": "闇の魔力(立ちのぼる)",
  "kind": "quad",
  "tex": "darkmagicsmoke",
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   10,
   20
  ],
  "g": [
   0,
   -2
  ],
  "life": [
   2,
   7
  ],
  "size": [
   0,
   60
  ],
  "r": [
   1,
   1
  ],
  "alpha": [
   0,
   200
  ],
  "c1": [
   243,
   0,
   255
  ],
  "c2": [
   8,
   2,
   20
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 30,
  "flow": 4,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "StarSparks": {
  "label": "星の火花",
  "kind": "quad",
  "tex": "glow",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   50,
   90
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.2,
   1
  ],
  "size": [
   10,
   0
  ],
  "r": [
   1,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   74,
   255,
   242
  ],
  "c2": [
   0,
   33,
   255
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 30,
  "flow": 60,
  "tank": -1,
  "max": 300,
  "tw": 128,
  "th": 128
 },
 "BasicSnowFlakes": {
  "label": "雪の結晶",
  "kind": "quad",
  "tex": "snowflake2",
  "add": true,
  "dir": 90,
  "cone": 180,
  "f": [
   35,
   45
  ],
  "g": [
   0,
   10
  ],
  "life": [
   6,
   8
  ],
  "size": [
   6,
   0
  ],
  "r": [
   3,
   6
  ],
  "alpha": [
   0,
   255
  ],
  "c1": [
   157,
   167,
   206
  ],
  "c2": [
   238,
   246,
   248
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   90,
   130
  ],
  "zone": 400,
  "flow": 2,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "BasicSnow2": {
  "label": "雪(点)",
  "kind": "point",
  "tex": null,
  "add": true,
  "dir": 90,
  "cone": 180,
  "f": [
   35,
   45
  ],
  "g": [
   0,
   0
  ],
  "life": [
   6,
   8
  ],
  "size": [
   100,
   0
  ],
  "r": [
   3,
   6
  ],
  "alpha": [
   0,
   255
  ],
  "c1": [
   157,
   167,
   206
  ],
  "c2": [
   238,
   246,
   248
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 300,
  "flow": 10,
  "tank": -1,
  "max": 300
 },
 "Hyperspace2": {
  "label": "ワープ(光の筋)",
  "kind": "quad",
  "tex": "trail",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   3000,
   6000
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.2,
   0.8
  ],
  "size": [
   0,
   100
  ],
  "r": [
   400,
   25
  ],
  "alpha": [
   255,
   0
  ],
  "c1": [
   255,
   255,
   255
  ],
  "c2": [
   0,
   6,
   255
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 5,
  "flow": 600,
  "tank": -1,
  "max": 1000,
  "tw": 800,
  "th": 252
 },
 "Hyperspace": {
  "label": "ワープ(線)",
  "kind": "line",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   1000,
   4000
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.2,
   0.8
  ],
  "size": [
   0,
   100
  ],
  "r": [
   4000,
   20
  ],
  "alpha": [
   255,
   0
  ],
  "c1": [
   255,
   255,
   255
  ],
  "c2": [
   0,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 5,
  "flow": 300,
  "tank": -1,
  "max": 1000
 },
 "BasicRain": {
  "label": "雨",
  "kind": "line",
  "tex": null,
  "add": false,
  "dir": 80,
  "cone": 1,
  "f": [
   300,
   300
  ],
  "g": [
   100,
   700
  ],
  "life": [
   1,
   2
  ],
  "size": [
   20,
   100
  ],
  "r": [
   16,
   2
  ],
  "alpha": [
   0,
   100
  ],
  "c1": [
   80,
   131,
   168
  ],
  "c2": [
   107,
   225,
   255
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 600,
  "flow": 200,
  "tank": -1,
  "max": 1000
 },
 "BasicSnow": {
  "label": "雪",
  "kind": "quad",
  "tex": "glow",
  "add": true,
  "dir": 90,
  "cone": 180,
  "f": [
   25,
   35
  ],
  "g": [
   0,
   0
  ],
  "life": [
   6,
   8
  ],
  "size": [
   20,
   0
  ],
  "r": [
   6,
   6
  ],
  "alpha": [
   0,
   255
  ],
  "c1": [
   157,
   167,
   206
  ],
  "c2": [
   238,
   246,
   248
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 300,
  "flow": 20,
  "tank": -1,
  "max": 300,
  "tw": 128,
  "th": 128
 },
 "BasicLiquidDrops": {
  "label": "しぶき(粒)",
  "kind": "point",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 180,
  "f": [
   20,
   120
  ],
  "g": [
   0,
   800
  ],
  "life": [
   1,
   2
  ],
  "size": [
   80,
   0
  ],
  "r": [
   4,
   4
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   189,
   250,
   255
  ],
  "c2": [
   13,
   127,
   255
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 15,
  "flow": 100,
  "tank": -1,
  "max": 300
 },
 "BasicLiquid": {
  "label": "水の噴き出し",
  "kind": "quad",
  "tex": "water",
  "add": false,
  "dir": -90,
  "cone": 90,
  "f": [
   50,
   200
  ],
  "g": [
   0,
   1200
  ],
  "life": [
   1,
   2
  ],
  "size": [
   10,
   35
  ],
  "r": [
   6,
   2
  ],
  "alpha": [
   150,
   0
  ],
  "c1": [
   93,
   238,
   255
  ],
  "c2": [
   0,
   36,
   77
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 5,
  "flow": 200,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "BlueSparks": {
  "label": "青い火花",
  "kind": "line",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 90,
  "f": [
   130,
   300
  ],
  "g": [
   0,
   600
  ],
  "life": [
   1,
   2
  ],
  "size": [
   100,
   0
  ],
  "r": [
   5,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   14,
   238,
   255
  ],
  "c2": [
   0,
   33,
   122
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 5,
  "flow": 80,
  "tank": -1,
  "max": 300
 },
 "Sparks": {
  "label": "火花(噴水)",
  "kind": "line",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 90,
  "f": [
   100,
   300
  ],
  "g": [
   0,
   600
  ],
  "life": [
   1,
   2
  ],
  "size": [
   100,
   0
  ],
  "r": [
   6,
   2
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   215,
   14
  ],
  "c2": [
   122,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 5,
  "flow": 60,
  "tank": -1,
  "max": 300
 },
 "BasicSparks": {
  "label": "火花",
  "kind": "line",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 45,
  "f": [
   100,
   300
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.2,
   1
  ],
  "size": [
   100,
   0
  ],
  "r": [
   6,
   4
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   215,
   14
  ],
  "c2": [
   122,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 30,
  "flow": 60,
  "tank": -1,
  "max": 300
 },
 "DarkMagicFog": {
  "label": "闇の霧",
  "kind": "quad",
  "tex": "darkmagicsmoke",
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   20,
   30
  ],
  "g": [
   0,
   0
  ],
  "life": [
   1,
   2
  ],
  "size": [
   0,
   100
  ],
  "r": [
   50,
   50
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   0,
   0,
   0
  ],
  "c2": [
   78,
   146,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 15,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "DarkMagicSmoke2": {
  "label": "闇の煙 2",
  "kind": "quad",
  "tex": "explosionfog_texture_2",
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   20,
   30
  ],
  "g": [
   0,
   0
  ],
  "life": [
   1,
   2
  ],
  "size": [
   0,
   100
  ],
  "r": [
   50,
   50
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   0,
   0,
   0
  ],
  "c2": [
   146,
   0,
   46
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 15,
  "tank": -1,
  "max": 300,
  "tw": 240,
  "th": 240
 },
 "DarkMagicSmoke": {
  "label": "闇の煙",
  "kind": "quad",
  "tex": "explosionfog_texture_2",
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   20,
   30
  ],
  "g": [
   0,
   0
  ],
  "life": [
   1,
   2
  ],
  "size": [
   0,
   100
  ],
  "r": [
   50,
   50
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   0,
   0,
   0
  ],
  "c2": [
   101,
   0,
   255
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 15,
  "tank": -1,
  "max": 300,
  "tw": 240,
  "th": 240
 },
 "PixelSmoke": {
  "label": "ドットの煙",
  "kind": "line",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   150,
   250
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.5,
   1.5
  ],
  "size": [
   0,
   100
  ],
  "r": [
   100,
   100
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   20,
   20,
   20
  ],
  "c2": [
   63,
   63,
   63
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 15,
  "tank": -1,
  "max": 300
 },
 "BasicSmoke": {
  "label": "煙",
  "kind": "quad",
  "tex": "explosiontexture_smoke_1",
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   150,
   250
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.5,
   1.5
  ],
  "size": [
   0,
   70
  ],
  "r": [
   50,
   1
  ],
  "alpha": [
   150,
   0
  ],
  "c1": [
   20,
   20,
   20
  ],
  "c2": [
   63,
   63,
   63
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 15,
  "tank": -1,
  "max": 300,
  "tw": 240,
  "th": 240
 },
 "LightningTexture": {
  "label": "稲妻",
  "kind": "quad",
  "tex": "lightning_texture_1",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   10,
   20
  ],
  "g": [
   0,
   -60
  ],
  "life": [
   1,
   2
  ],
  "size": [
   0,
   100
  ],
  "r": [
   200,
   200
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   0,
   166,
   255
  ],
  "c2": [
   0,
   2,
   112
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": 6,
  "max": 300,
  "tw": 900,
  "th": 900
 },
 "BasicExplosionFlame": {
  "label": "爆発の炎",
  "kind": "quad",
  "tex": "explosionfog_texture_2",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   10,
   20
  ],
  "g": [
   0,
   -60
  ],
  "life": [
   1,
   2
  ],
  "size": [
   0,
   100
  ],
  "r": [
   200,
   200
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   90,
   90,
   90
  ],
  "c2": [
   14,
   14,
   14
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": 6,
  "max": 300,
  "tw": 240,
  "th": 240
 },
 "BloodImpact2": {
  "label": "血しぶき 2",
  "kind": "quad",
  "tex": "blood3",
  "add": false,
  "dir": -90,
  "cone": 360,
  "f": [
   1,
   4
  ],
  "g": [
   0,
   0
  ],
  "life": [
   1,
   3
  ],
  "size": [
   60,
   70
  ],
  "r": [
   80,
   8
  ],
  "alpha": [
   255,
   0
  ],
  "c1": [
   117,
   14,
   32
  ],
  "c2": [
   179,
   31,
   31
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 1,
  "tank": 2,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "BloodImpact": {
  "label": "血しぶき",
  "kind": "quad",
  "tex": "blood1",
  "add": false,
  "dir": -90,
  "cone": 360,
  "f": [
   1,
   4
  ],
  "g": [
   0,
   0
  ],
  "life": [
   1.5,
   4
  ],
  "size": [
   40,
   60
  ],
  "r": [
   80,
   8
  ],
  "alpha": [
   255,
   0
  ],
  "c1": [
   82,
   6,
   6
  ],
  "c2": [
   173,
   23,
   23
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 1,
  "tank": 2,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "BasicExplosionSmooth": {
  "label": "爆発(なめらか)",
  "kind": "quad",
  "tex": "explosiontexture1",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   80,
   100
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.5,
   1.5
  ],
  "size": [
   10,
   120
  ],
  "r": [
   80,
   8
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   8,
   8,
   8
  ],
  "c2": [
   36,
   36,
   36
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": 25,
  "max": 300,
  "tw": 240,
  "th": 240
 },
 "BasicExplosionEnergySparks": {
  "label": "爆発の火花(エネルギー)",
  "kind": "point",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   120,
   220
  ],
  "g": [
   0,
   80
  ],
  "life": [
   0.5,
   1.5
  ],
  "size": [
   100,
   0
  ],
  "r": [
   4,
   8
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   40,
   167
  ],
  "c2": [
   72,
   0,
   119
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 12,
  "flow": 100,
  "tank": 35,
  "max": 300
 },
 "BloodDrops": {
  "label": "血のしたたり",
  "kind": "quad",
  "tex": "blood2",
  "add": false,
  "dir": 90,
  "cone": 1,
  "f": [
   0,
   0
  ],
  "g": [
   0,
   0
  ],
  "life": [
   4,
   6
  ],
  "size": [
   50,
   100
  ],
  "r": [
   4,
   8
  ],
  "alpha": [
   120,
   0
  ],
  "c1": [
   185,
   13,
   25
  ],
  "c2": [
   63,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 200,
  "flow": 1,
  "tank": 2,
  "max": 12,
  "tw": 800,
  "th": 800
 },
 "BasicExplosionSharp": {
  "label": "爆発の火花",
  "kind": "point",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   80,
   170
  ],
  "g": [
   0,
   100
  ],
  "life": [
   0.5,
   1.5
  ],
  "size": [
   100,
   0
  ],
  "r": [
   4,
   8
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   122,
   40
  ],
  "c2": [
   255,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 12,
  "flow": 100,
  "tank": 35,
  "max": 300
 },
 "BasicExplosionEnergy": {
  "label": "爆発(エネルギー)",
  "kind": "quad",
  "tex": "explosionfog_texture_2",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   50,
   90
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.5,
   1.5
  ],
  "size": [
   100,
   0
  ],
  "r": [
   120,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   40,
   232,
   255
  ],
  "c2": [
   97,
   0,
   194
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": 30,
  "max": 300,
  "tw": 240,
  "th": 240
 },
 "BasicExplosion": {
  "label": "爆発",
  "kind": "quad",
  "tex": "glow",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   50,
   90
  ],
  "g": [
   0,
   100
  ],
  "life": [
   0.5,
   1.5
  ],
  "size": [
   100,
   0
  ],
  "r": [
   120,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   122,
   40
  ],
  "c2": [
   255,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": 30,
  "max": 300,
  "tw": 128,
  "th": 128
 },
 "DarkMagic": {
  "label": "闇の魔法",
  "kind": "quad",
  "tex": "glow",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   30,
   40
  ],
  "g": [
   0,
   0
  ],
  "life": [
   2,
   4
  ],
  "size": [
   20,
   100
  ],
  "r": [
   8,
   8
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   0,
   0,
   0
  ],
  "c2": [
   0,
   255,
   6
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": -1,
  "max": 300,
  "tw": 128,
  "th": 128
 },
 "Magic4": {
  "label": "魔法 4",
  "kind": "quad",
  "tex": "glow",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   30,
   40
  ],
  "g": [
   0,
   0
  ],
  "life": [
   2,
   4
  ],
  "size": [
   20,
   100
  ],
  "r": [
   8,
   8
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   0,
   0,
   0
  ],
  "c2": [
   168,
   29,
   7
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": -1,
  "max": 300,
  "tw": 128,
  "th": 128
 },
 "Magic3": {
  "label": "魔法 3",
  "kind": "quad",
  "tex": "glow",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   30,
   40
  ],
  "g": [
   0,
   0
  ],
  "life": [
   2,
   4
  ],
  "size": [
   20,
   100
  ],
  "r": [
   8,
   8
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   0,
   0,
   0
  ],
  "c2": [
   110,
   0,
   255
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": -1,
  "max": 300,
  "tw": 128,
  "th": 128
 },
 "Magic2": {
  "label": "魔法 2(もや)",
  "kind": "quad",
  "tex": "darkmagicsmoke",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   5,
   8
  ],
  "g": [
   0,
   0
  ],
  "life": [
   4,
   8
  ],
  "size": [
   0,
   40
  ],
  "r": [
   1,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   252,
   0,
   255
  ],
  "c2": [
   119,
   0,
   255
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 2,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "Magic": {
  "label": "魔法",
  "kind": "quad",
  "tex": "explosionfog_texture_2",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   5,
   10
  ],
  "g": [
   0,
   0
  ],
  "life": [
   2,
   4
  ],
  "size": [
   30,
   0
  ],
  "r": [
   1,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   43,
   151,
   255
  ],
  "c2": [
   127,
   0,
   236
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": -1,
  "max": 300,
  "tw": 240,
  "th": 240
 },
 "SmoothFlame": {
  "label": "炎(なめらか)",
  "kind": "quad",
  "tex": "explosionfog_texture_2",
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   200,
   300
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.2,
   1
  ],
  "size": [
   50,
   0
  ],
  "r": [
   1,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   122,
   40
  ],
  "c2": [
   255,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": -1,
  "max": 300,
  "tw": 240,
  "th": 240
 },
 "PixelFlame": {
  "label": "ドットの炎",
  "kind": "line",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   200,
   300
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.2,
   1
  ],
  "size": [
   100,
   0
  ],
  "r": [
   40,
   40
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   122,
   40
  ],
  "c2": [
   255,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 20,
  "flow": 200,
  "tank": -1,
  "max": 300
 },
 "SparksPoint2": {
  "label": "光の粒(たくさん)",
  "kind": "quad",
  "tex": "glow",
  "add": true,
  "dir": -90,
  "cone": 360,
  "f": [
   0,
   0
  ],
  "g": [
   0,
   0
  ],
  "life": [
   5,
   6
  ],
  "size": [
   8,
   0
  ],
  "r": [
   3,
   1
  ],
  "alpha": [
   255,
   0
  ],
  "c1": [
   255,
   122,
   40
  ],
  "c2": [
   255,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 1000,
  "tank": -1,
  "max": 10000,
  "tw": 128,
  "th": 128
 },
 "SparksPoint": {
  "label": "光の粒",
  "kind": "quad",
  "tex": "glow",
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   50,
   90
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.2,
   1
  ],
  "size": [
   20,
   0
  ],
  "r": [
   3,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   122,
   40
  ],
  "c2": [
   255,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": -1,
  "max": 300,
  "tw": 128,
  "th": 128
 },
 "BasicFlame": {
  "label": "炎",
  "kind": "point",
  "tex": null,
  "add": true,
  "dir": -90,
  "cone": 1,
  "f": [
   200,
   300
  ],
  "g": [
   0,
   0
  ],
  "life": [
   0.2,
   1
  ],
  "size": [
   100,
   0
  ],
  "r": [
   25,
   1
  ],
  "alpha": [
   204,
   0
  ],
  "c1": [
   255,
   122,
   40
  ],
  "c2": [
   255,
   0,
   0
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   0,
   0
  ],
  "zone": 3,
  "flow": 100,
  "tank": -1,
  "max": 300
 },
 "Circle01": {
  "label": "魔法陣 1",
  "kind": "quad",
  "tex": "runes1",
  "add": true,
  "dir": -90,
  "cone": 90,
  "f": [
   0,
   0
  ],
  "g": [
   0,
   0
  ],
  "life": [
   3,
   6
  ],
  "size": [
   60,
   5
  ],
  "r": [
   100,
   1
  ],
  "alpha": [
   0,
   200
  ],
  "c1": [
   51,
   63,
   255
  ],
  "c2": [
   43,
   0,
   133
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   100,
   200
  ],
  "zone": 3,
  "flow": 1,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 },
 "Circle02": {
  "label": "魔法陣 2",
  "kind": "quad",
  "tex": "runes1",
  "add": true,
  "dir": -90,
  "cone": 90,
  "f": [
   0,
   0
  ],
  "g": [
   0,
   0
  ],
  "life": [
   3,
   6
  ],
  "size": [
   40,
   2
  ],
  "r": [
   100,
   1
  ],
  "alpha": [
   0,
   200
  ],
  "c1": [
   255,
   51,
   172
  ],
  "c2": [
   108,
   0,
   190
  ],
  "cmode": [
   "Enabled",
   "Random",
   "Random"
  ],
  "rot": [
   400,
   800
  ],
  "zone": 3,
  "flow": 1,
  "tank": -1,
  "max": 300,
  "tw": 800,
  "th": 800
 }
};
