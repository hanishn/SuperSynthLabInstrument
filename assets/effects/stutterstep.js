// Synth Lab - Stutterstep Effect (ES5 factory)
// Tempo-synced beat-repeat / glitch-stutter.
// Captures a rolling 2 s buffer; every trigger (tempo-sync'd) replays the most
// recent `sliceLen` ms `repeatCount` times with gate / pitch / chaos variations.

(function () {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // ---- named constants (NO magic numbers) ----
  var DEFAULT_MIX_PCT          = 50;
  var DEFAULT_SLICE_LEN_MS     = 60;
  var DEFAULT_REPEAT_COUNT     = 4;
  var DEFAULT_RATE_DIVISION    = 2;   // 1/16
  var DEFAULT_TEMPO_BPM        = 120;
  var DEFAULT_GATE_DUTY        = 0.8;
  var DEFAULT_PITCH_PER_REPEAT = 0;
  var DEFAULT_CHAOS            = 0;

  var MIX_PCT_MIN        = 0;
  var MIX_PCT_MAX        = 100;
  var MIX_PCT_TO_RATIO   = 100;
  var SLICE_LEN_MS_MIN   = 16;
  var SLICE_LEN_MS_MAX   = 1000;
  var REPEAT_COUNT_MIN   = 1;
  var REPEAT_COUNT_MAX   = 16;
  var RATE_DIVISION_MIN  = 0;
  var RATE_DIVISION_MAX  = 5;
  var TEMPO_BPM_MIN      = 60;
  var TEMPO_BPM_MAX      = 240;
  var GATE_DUTY_MIN      = 0;
  var GATE_DUTY_MAX      = 1;
  var PITCH_SEMI_MIN     = -12;
  var PITCH_SEMI_MAX     = 12;
  var CHAOS_MIN          = 0;
  var CHAOS_MAX          = 1;

  var PARAM_SMOOTH_SEC   = 0.01;

  function clamp(v, lo, hi) {
    if (v < lo) { return lo; }
    if (v > hi) { return hi; }
    return v;
  }

  // ---- Inline worklet source (kept in-sync with ./stutterstep-worklet.js) ----
  // Self-contained so a blob URL can register the processor without an extra fetch.
  var workletCode = [
    'const STUTTER_NUM_CHANNELS=2;',
    'const RING_SECONDS=2.0;',
    'const SEC_PER_MIN=60.0;',
    'const MS_PER_SEC=1000.0;',
    'const SEMITONES_PER_OCTAVE=12.0;',
    'const SLICE_LEN_MIN_MS=16.0;',
    'const SLICE_LEN_MAX_MS=1000.0;',
    'const REPEAT_COUNT_MIN=1;',
    'const REPEAT_COUNT_MAX=16;',
    'const TEMPO_BPM_MIN=60.0;',
    'const TEMPO_BPM_MAX=240.0;',
    'const GATE_DUTY_MIN=0.0;',
    'const GATE_DUTY_MAX=1.0;',
    'const CHAOS_MIN=0.0;',
    'const CHAOS_MAX=1.0;',
    'const PITCH_SEMI_MIN=-12.0;',
    'const PITCH_SEMI_MAX=12.0;',
    'const RATE_DIVISION_MIN=0;',
    'const RATE_DIVISION_MAX=5;',
    'const RATE_DIVISION_DEFAULT=2;',
    'const GATE_FADE_FRAMES=64;',
    'const CHAOS_SKIP_THRESHOLD=0.85;',
    'const CHAOS_SHORTEN_MIN_FRAC=0.3;',
    'const TEMPO_BPM_DEFAULT=120.0;',
    'const SLICE_LEN_DEFAULT_MS=60.0;',
    'const REPEAT_COUNT_DEFAULT=4;',
    'const GATE_DUTY_DEFAULT=0.8;',
    'const CHAOS_DEFAULT=0.0;',
    'const PITCH_PER_REPEAT_DEFAULT=0.0;',
    'const RATE_DIV_QUARTER=1.0/4.0;',
    'const RATE_DIV_EIGHTH=1.0/8.0;',
    'const RATE_DIV_SIXTEENTH=1.0/16.0;',
    'const RATE_DIV_THIRTYSEC=1.0/32.0;',
    'const RATE_DIV_EIGHTH_T=1.0/12.0;',
    'const RATE_DIV_SIXTEEN_T=1.0/24.0;',
    'function rateDivisionToFraction(idx){',
    '  const r=Math.round(idx);',
    '  if(r<=0){return RATE_DIV_QUARTER;}',
    '  if(r===1){return RATE_DIV_EIGHTH;}',
    '  if(r===2){return RATE_DIV_SIXTEENTH;}',
    '  if(r===3){return RATE_DIV_THIRTYSEC;}',
    '  if(r===4){return RATE_DIV_EIGHTH_T;}',
    '  return RATE_DIV_SIXTEEN_T;',
    '}',
    'class StutterstepProcessor extends AudioWorkletProcessor {',
    '  static get parameterDescriptors(){return [',
    '    {name:"sliceLenMs",defaultValue:SLICE_LEN_DEFAULT_MS,minValue:SLICE_LEN_MIN_MS,maxValue:SLICE_LEN_MAX_MS,automationRate:"k-rate"},',
    '    {name:"repeatCount",defaultValue:REPEAT_COUNT_DEFAULT,minValue:REPEAT_COUNT_MIN,maxValue:REPEAT_COUNT_MAX,automationRate:"k-rate"},',
    '    {name:"rateDivision",defaultValue:RATE_DIVISION_DEFAULT,minValue:RATE_DIVISION_MIN,maxValue:RATE_DIVISION_MAX,automationRate:"k-rate"},',
    '    {name:"tempoBpm",defaultValue:TEMPO_BPM_DEFAULT,minValue:TEMPO_BPM_MIN,maxValue:TEMPO_BPM_MAX,automationRate:"k-rate"},',
    '    {name:"gateDuty",defaultValue:GATE_DUTY_DEFAULT,minValue:GATE_DUTY_MIN,maxValue:GATE_DUTY_MAX,automationRate:"k-rate"},',
    '    {name:"pitchPerRepeat",defaultValue:PITCH_PER_REPEAT_DEFAULT,minValue:PITCH_SEMI_MIN,maxValue:PITCH_SEMI_MAX,automationRate:"k-rate"},',
    '    {name:"chaos",defaultValue:CHAOS_DEFAULT,minValue:CHAOS_MIN,maxValue:CHAOS_MAX,automationRate:"k-rate"}',
    '  ];}',
    '  constructor(){',
    '    super();',
    '    const rf=Math.max(1,Math.floor(RING_SECONDS*sampleRate));',
    '    this.ringFrames=rf;',
    '    this.ringL=new Float32Array(rf);',
    '    this.ringR=new Float32Array(rf);',
    '    this.ringWritePos=0;',
    '    this.framesSinceTrigger=0;',
    '    this.needInitialTrigger=true;',
    '    this.sliceL=null;this.sliceR=null;this.sliceLenFrames=0;',
    '    this.repeatIndex=0;this.totalRepeats=0;',
    '    this.repeatPlayFrames=0;this.repeatLenFrames=0;',
    '    this.repeatPitchRatio=1.0;this.sliceReadPos=0.0;',
    '    this.repeatSkip=false;this.repeatShortenFrac=1.0;',
    '    this.repeatGateEndFrames=0;',
    '    this.stutterActive=false;',
    '  }',
    '  _writeRing(l,r){',
    '    this.ringL[this.ringWritePos]=l;',
    '    this.ringR[this.ringWritePos]=r;',
    '    this.ringWritePos++;',
    '    if(this.ringWritePos>=this.ringFrames){this.ringWritePos=0;}',
    '  }',
    '  _snapshotSlice(sliceLenFrames){',
    '    const len=Math.min(sliceLenFrames,this.ringFrames);',
    '    const oL=new Float32Array(len);',
    '    const oR=new Float32Array(len);',
    '    let src=this.ringWritePos-len;',
    '    if(src<0){src+=this.ringFrames;}',
    '    for(let i=0;i<len;i++){',
    '      oL[i]=this.ringL[src];oR[i]=this.ringR[src];',
    '      src++;if(src>=this.ringFrames){src=0;}',
    '    }',
    '    this.sliceL=oL;this.sliceR=oR;this.sliceLenFrames=len;',
    '  }',
    '  _beginRepeat(pitchSemis,gateDuty,chaos){',
    '    const semis=pitchSemis*this.repeatIndex;',
    '    this.repeatPitchRatio=Math.pow(2.0,semis/SEMITONES_PER_OCTAVE);',
    '    const nat=Math.floor(this.sliceLenFrames/this.repeatPitchRatio);',
    '    this.repeatLenFrames=Math.max(1,nat);',
    '    let skip=false;let shortenFrac=1.0;',
    '    if(chaos>CHAOS_MIN){',
    '      const rS=Math.random();',
    '      if(rS<chaos*CHAOS_SKIP_THRESHOLD*0.5){skip=true;}',
    '      else{',
    '        const rSh=Math.random();',
    '        if(rSh<chaos){shortenFrac=CHAOS_SHORTEN_MIN_FRAC+(1.0-CHAOS_SHORTEN_MIN_FRAC)*(1.0-rSh);}',
    '      }',
    '    }',
    '    this.repeatSkip=skip;this.repeatShortenFrac=shortenFrac;',
    '    this.repeatPlayFrames=0;this.sliceReadPos=0.0;',
    '    const gLen=Math.max(1,Math.floor(this.repeatLenFrames*gateDuty*shortenFrac));',
    '    this.repeatGateEndFrames=gLen;',
    '  }',
    '  _gateEnvelope(frame,gateEndFrames){',
    '    if(frame>=gateEndFrames){return 0.0;}',
    '    const fade=Math.min(GATE_FADE_FRAMES,Math.floor(gateEndFrames/2));',
    '    if(fade<=0){return 1.0;}',
    '    if(frame<fade){return frame/fade;}',
    '    if(frame>gateEndFrames-fade){return (gateEndFrames-frame)/fade;}',
    '    return 1.0;',
    '  }',
    '  _sampleSliceL(pos){',
    '    const i0=Math.floor(pos);',
    '    if(i0<0||i0>=this.sliceLenFrames){return 0.0;}',
    '    const i1=i0+1<this.sliceLenFrames?i0+1:i0;',
    '    const f=pos-i0;',
    '    return this.sliceL[i0]*(1.0-f)+this.sliceL[i1]*f;',
    '  }',
    '  _sampleSliceR(pos){',
    '    const i0=Math.floor(pos);',
    '    if(i0<0||i0>=this.sliceLenFrames){return 0.0;}',
    '    const i1=i0+1<this.sliceLenFrames?i0+1:i0;',
    '    const f=pos-i0;',
    '    return this.sliceR[i0]*(1.0-f)+this.sliceR[i1]*f;',
    '  }',
    '  process(inputs,outputs,parameters){',
    '    const input=inputs[0];const output=outputs[0];',
    '    if(!output||output.length===0){return true;}',
    '    const outL=output[0];',
    '    const outR=output.length>1?output[1]:output[0];',
    '    const hasIn=input&&input.length>0&&input[0]&&input[0].length>0;',
    '    const inL=hasIn?input[0]:null;',
    '    const inR=hasIn?((input.length>1&&input[1])?input[1]:input[0]):null;',
    '    const sliceLenMs=parameters.sliceLenMs[0];',
    '    const repeatCount=Math.round(parameters.repeatCount[0]);',
    '    const rateDivIdx=parameters.rateDivision[0];',
    '    const tempoBpm=parameters.tempoBpm[0];',
    '    const gateDuty=parameters.gateDuty[0];',
    '    const pitchPerRepeat=parameters.pitchPerRepeat[0];',
    '    const chaos=parameters.chaos[0];',
    '    const subdivision=rateDivisionToFraction(rateDivIdx);',
    '    const quarterSec=SEC_PER_MIN/tempoBpm;',
    '    const periodSec=quarterSec*(subdivision/RATE_DIV_QUARTER);',
    '    const triggerPeriodFrames=Math.max(1,Math.floor(periodSec*sampleRate));',
    '    const sliceLenFrames=Math.max(1,Math.floor((sliceLenMs/MS_PER_SEC)*sampleRate));',
    '    const blockSize=outL.length;',
    '    for(let i=0;i<blockSize;i++){',
    '      const l=inL?inL[i]:0.0;',
    '      const r=inR?inR[i]:0.0;',
    '      this._writeRing(l,r);',
    '      this.framesSinceTrigger++;',
    '      const shouldTrigger=this.needInitialTrigger||this.framesSinceTrigger>=triggerPeriodFrames;',
    '      if(shouldTrigger){',
    '        this.needInitialTrigger=false;',
    '        this.framesSinceTrigger=0;',
    '        this._snapshotSlice(sliceLenFrames);',
    '        this.totalRepeats=repeatCount;',
    '        this.repeatIndex=0;',
    '        this.stutterActive=true;',
    '        this._beginRepeat(pitchPerRepeat,gateDuty,chaos);',
    '      }',
    '      let oSL=0.0;let oSR=0.0;',
    '      if(this.stutterActive&&this.sliceL){',
    '        if(this.repeatSkip){oSL=0.0;oSR=0.0;}',
    '        else{',
    '          const env=this._gateEnvelope(this.repeatPlayFrames,this.repeatGateEndFrames);',
    '          if(env>0.0){',
    '            oSL=this._sampleSliceL(this.sliceReadPos)*env;',
    '            oSR=this._sampleSliceR(this.sliceReadPos)*env;',
    '          }',
    '        }',
    '        this.sliceReadPos+=this.repeatPitchRatio;',
    '        this.repeatPlayFrames++;',
    '        if(this.repeatPlayFrames>=this.repeatLenFrames){',
    '          this.repeatIndex++;',
    '          if(this.repeatIndex>=this.totalRepeats){this.stutterActive=false;}',
    '          else{this._beginRepeat(pitchPerRepeat,gateDuty,chaos);}',
    '        }',
    '      }',
    '      outL[i]=oSL;outR[i]=oSR;',
    '    }',
    '    return true;',
    '  }',
    '}',
    'registerProcessor("stutterstep-processor",StutterstepProcessor);'
  ].join('\n');

  // ---------------- Effect class ----------------
  // BaseEffect is an ES6 class, which cannot be called via .call(this,...).
  // Use Reflect.construct to subclass it from an ES5 factory.
  function StutterstepEffect(ctx) {
    var self = Reflect.construct(BaseEffect, [ctx, 'stutterstep'], StutterstepEffect);

    self.params.mix            = DEFAULT_MIX_PCT;
    self.params.sliceLen       = DEFAULT_SLICE_LEN_MS;
    self.params.repeatCount    = DEFAULT_REPEAT_COUNT;
    self.params.rateDivision   = DEFAULT_RATE_DIVISION;
    self.params.tempoBpm       = DEFAULT_TEMPO_BPM;
    self.params.gateDuty       = DEFAULT_GATE_DUTY;
    self.params.pitchPerRepeat = DEFAULT_PITCH_PER_REPEAT;
    self.params.chaos          = DEFAULT_CHAOS;

    self.workletNode = null;
    self.workletReady = false;
    self.useWorklet = false;

    self._init();
    return self;
  }
  StutterstepEffect.prototype = Object.create(BaseEffect.prototype);
  StutterstepEffect.prototype.constructor = StutterstepEffect;

  StutterstepEffect.prototype._init = function () {
    var self = this;
    var hasWorklet = !!(this.ctx && this.ctx.audioWorklet);
    var initSucceeded = false;
    if (hasWorklet) {
      var blob = new Blob([workletCode], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      var p = this.ctx.audioWorklet.addModule(url);
      p.then(function () {
        try {
          self.workletNode = new AudioWorkletNode(self.ctx, 'stutterstep-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2]
          });
          self.input.connect(self.workletNode);
          self.workletNode.connect(self.wetGain);
          self._pushAllParams();
          self.workletReady = true;
          self.useWorklet = true;
          initSucceeded = true;
        } catch (err) {
          console.warn('Stutterstep: worklet node creation failed', err);
        }
        URL.revokeObjectURL(url);
      }).catch(function (err) {
        console.warn('Stutterstep: AudioWorklet addModule failed', err);
        URL.revokeObjectURL(url);
      });
    } else {
      console.warn('Stutterstep: no AudioWorklet on this context (pass-through only)');
    }
    // initSucceeded intentionally retained as a debuggable var
    this._initSucceeded = initSucceeded;
  };

  StutterstepEffect.prototype._setWorkletParam = function (name, value) {
    if (!this.workletNode) { return; }
    var p = this.workletNode.parameters.get(name);
    if (p) {
      p.setTargetAtTime(value, this.ctx.currentTime, PARAM_SMOOTH_SEC);
    }
  };

  StutterstepEffect.prototype._pushAllParams = function () {
    this._setWorkletParam('sliceLenMs',     this.params.sliceLen);
    this._setWorkletParam('repeatCount',    this.params.repeatCount);
    this._setWorkletParam('rateDivision',   this.params.rateDivision);
    this._setWorkletParam('tempoBpm',       this.params.tempoBpm);
    this._setWorkletParam('gateDuty',       this.params.gateDuty);
    this._setWorkletParam('pitchPerRepeat', this.params.pitchPerRepeat);
    this._setWorkletParam('chaos',          this.params.chaos);
  };

  StutterstepEffect.prototype.updateParam = function (name, value) {
    var v = value;
    if (name === 'sliceLen') {
      v = clamp(v, SLICE_LEN_MS_MIN, SLICE_LEN_MS_MAX);
      this.params.sliceLen = v;
      this._setWorkletParam('sliceLenMs', v);
    } else if (name === 'repeatCount') {
      v = Math.round(clamp(v, REPEAT_COUNT_MIN, REPEAT_COUNT_MAX));
      this.params.repeatCount = v;
      this._setWorkletParam('repeatCount', v);
    } else if (name === 'rateDivision') {
      v = Math.round(clamp(v, RATE_DIVISION_MIN, RATE_DIVISION_MAX));
      this.params.rateDivision = v;
      this._setWorkletParam('rateDivision', v);
    } else if (name === 'tempoBpm') {
      v = clamp(v, TEMPO_BPM_MIN, TEMPO_BPM_MAX);
      this.params.tempoBpm = v;
      this._setWorkletParam('tempoBpm', v);
    } else if (name === 'gateDuty') {
      v = clamp(v, GATE_DUTY_MIN, GATE_DUTY_MAX);
      this.params.gateDuty = v;
      this._setWorkletParam('gateDuty', v);
    } else if (name === 'pitchPerRepeat') {
      v = clamp(v, PITCH_SEMI_MIN, PITCH_SEMI_MAX);
      this.params.pitchPerRepeat = v;
      this._setWorkletParam('pitchPerRepeat', v);
    } else if (name === 'chaos') {
      v = clamp(v, CHAOS_MIN, CHAOS_MAX);
      this.params.chaos = v;
      this._setWorkletParam('chaos', v);
    }
  };

  StutterstepEffect.prototype.dispose = function () {
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (e) { /* noop */ }
      this.workletNode = null;
    }
    BaseEffect.prototype.dispose.call(this);
  };

  // ---- Self-register (no shared-file edits) ----
  SL.effects.Stutterstep = StutterstepEffect;
  SL.effects.StutterstepEffect = StutterstepEffect;
  if (typeof SL.effects.register === 'function') {
    SL.effects.register('stutterstep', StutterstepEffect);
  }

  // Also register a lightweight metadata blob so any UI loader can pick it up.
  SL.effects._stutterstepMeta = {
    name: 'stutterstep',
    label: 'Stutterstep',
    params: [
      { name: 'mix',            min: MIX_PCT_MIN,       max: MIX_PCT_MAX,       def: DEFAULT_MIX_PCT },
      { name: 'sliceLen',       min: SLICE_LEN_MS_MIN,  max: SLICE_LEN_MS_MAX,  def: DEFAULT_SLICE_LEN_MS },
      { name: 'repeatCount',    min: REPEAT_COUNT_MIN,  max: REPEAT_COUNT_MAX,  def: DEFAULT_REPEAT_COUNT,     step: 1 },
      { name: 'rateDivision',   min: RATE_DIVISION_MIN, max: RATE_DIVISION_MAX, def: DEFAULT_RATE_DIVISION,    step: 1 },
      { name: 'tempoBpm',       min: TEMPO_BPM_MIN,     max: TEMPO_BPM_MAX,     def: DEFAULT_TEMPO_BPM },
      { name: 'gateDuty',       min: GATE_DUTY_MIN,     max: GATE_DUTY_MAX,     def: DEFAULT_GATE_DUTY },
      { name: 'pitchPerRepeat', min: PITCH_SEMI_MIN,    max: PITCH_SEMI_MAX,    def: DEFAULT_PITCH_PER_REPEAT },
      { name: 'chaos',          min: CHAOS_MIN,         max: CHAOS_MAX,         def: DEFAULT_CHAOS }
    ]
  };
})();
