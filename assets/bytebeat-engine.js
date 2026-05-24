// Super Synth Lab - Bytebeat Synthesis Engine
// Evaluates mathematical expressions on an incrementing counter t to generate audio
// Classic demoscene bytebeat: output = expression(t) & 255, scaled to -1..1
// ScriptProcessor based, monophonic (bytebeat is inherently single-voice)
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var DEFAULT_SAMPLE_RATE = 8000;
  var MIN_SAMPLE_RATE = 4000;
  var MAX_SAMPLE_RATE = 48000;

  /** Maximum time in ms allowed for a single audio process callback */
  var MAX_PROCESS_TIME_MS = 10;
  /** Number of consecutive formula errors before auto-disabling */
  var MAX_CONSECUTIVE_ERRORS = 50;
  /** Track consecutive formula errors */
  var _consecutiveErrors = 0;

  /** Built-in bytebeat formula library */
  var FORMULA_LIBRARY = [
    { name: 'Classic',           expr: 't*(t>>5|t>>8)',                         category: 'Classic' },
    { name: 'Sierpinski Melody', expr: 't*(t>>11&t>>8&123&t>>3)',              category: 'Classic' },
    { name: 'Simple Melody',     expr: '(t*(t>>12)&255)',                       category: 'Classic' },
    { name: 'Complex Harmony',   expr: 't*((t>>12|t>>8)&63&t>>4)',             category: 'Classic' },
    { name: 'Rhythmic Pulse',    expr: '(t&t>>8)*t>>4',                         category: 'Classic' },
    { name: 'Crowd Roar',        expr: 't*(t>>10^t>>11)%256',                  category: 'Melodic' },
    { name: 'Music Box',         expr: '(t*5&t>>7)|(t*3&t>>10)',               category: 'Melodic' },
    { name: 'Alien Song',        expr: 't*(t>>9|t>>13)&16',                    category: 'Melodic' },
    { name: 'Pipe Organ',        expr: '(t>>6|t|t>>(t>>16))*10+((t>>11)&7)',   category: 'Melodic' },
    { name: 'Chiptune March',    expr: '(t*((t>>12|t>>8)&63&t>>4))',           category: 'Melodic' },
    { name: 'Drum Machine',      expr: '(t>>4)*(13&(0x8898a989>>(t>>11&30)))', category: 'Rhythmic' },
    { name: 'Kick Snare',        expr: '((t<<1)^((t<<1)+(t>>7)&t>>12))|t>>(4-(1^7&(t>>19)))', category: 'Rhythmic' },
    { name: 'Bit Drummer',       expr: 't*((t>>5|t>>8)>>((t>>16)&7))',         category: 'Rhythmic' },
    { name: 'Glitch Beat',       expr: '(t>>7|t|t>>6)*10+4*(t&t>>13|t>>6)',    category: 'Rhythmic' },
    { name: 'Pulse Train',       expr: '(t*(t>>8*(t>>15|t>>8)&(20|(t>>19)*5>>t|t>>3)))', category: 'Rhythmic' },
    { name: 'Slow Drift',        expr: '(t>>8&t)*(t>>15&t)',                    category: 'Ambient' },
    { name: 'Wind Chimes',       expr: '(t*(t>>8|t>>9)&46&t>>8)',              category: 'Ambient' },
    { name: 'Deep Space',        expr: '(t>>4)*(t&t>>8)|(t>>6)',               category: 'Ambient' }
  ];

  /** Default bytebeat settings */
  var DEFAULT_BYTEBEAT_SETTINGS = {
    formula: 't*(t>>5|t>>8)',
    formulaIndex: 0,
    sampleRate: DEFAULT_SAMPLE_RATE,
    tIncrement: 1,
    bitDepth: 8,
    volume: 80
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var scriptNode = null;
  var engineReady = false;
  var playing = false;
  var settings = JSON.parse(JSON.stringify(DEFAULT_BYTEBEAT_SETTINGS));

  // Bytebeat counter
  var tCounter = 0;

  // Compiled formula function
  var formulaFn = null;

  // Volume envelope for fade in/out
  var targetVolume = 0;
  var currentVolume = 0;
  var volumeSmoothRate = 0.001;

  // Sample rate conversion
  var sampleAccumulator = 0;
  var lastBytebeatSample = 0;

  // Connected state
  var connectedInsts = [false, false, false, false];
  var filterNodes = {};

  // ============================================================
  // Formula Compilation
  // ============================================================

  /**
   * Validate a bytebeat expression string for safety.
   * Only allows: integer literals (decimal/hex), the variable t,
   * operators (+,-,*,/,%,&,|,^,~,<<,>>), and parentheses.
   * Rejects anything else (no identifiers, no function calls, no assignment).
   * Returns true if safe.
   */
  function isFormulaTokenSafe(expr) {
    // Tokenize with a whitelist regex.  Every character must be part of a
    // recognised token; if the concatenation of all tokens does not
    // reconstitute the original (minus whitespace), the expression is rejected.
    var TOKEN_RE = /(?:0[xX][0-9a-fA-F]+|[0-9]+|[t]|<<|>>|[+\-*\/%&|^~()])/g;
    var stripped = expr.replace(/\s+/g, '');
    var tokens = stripped.match(TOKEN_RE);
    if (!tokens) {
      return false;
    }
    var reconstructed = tokens.join('');
    return reconstructed === stripped;
  }

  /**
   * Compile a bytebeat expression string into a callable function.
   * The expression can use: t, &, |, ^, >>, <<, %, *, +, -, ~, (, )
   * and integer literals (decimal or hex like 0x8898a989).
   * Returns null if compilation fails or contains unsafe tokens.
   */
  function compileFormula(expr) {
    if (!expr || typeof expr !== 'string') {
      return null;
    }

    if (!isFormulaTokenSafe(expr)) {
      console.warn('[BYTEBEAT] Formula rejected: contains unsafe tokens');
      return null;
    }

    try {
      /* jshint -W054 */
      var rawFn = new Function('t', 'return (' + expr + ')|0;');
      /* jshint +W054 */
      // Test it does not throw with boundary values
      rawFn(0);
      rawFn(1000);
      rawFn(1000000);
      // Wrap in a try/catch sandbox so runtime errors are contained
      var sandboxedFn = function(tVal) {
        try {
          return rawFn(tVal);
        } catch (runErr) {
          return 0;
        }
      };
      _consecutiveErrors = 0;
      return sandboxedFn;
    } catch (e) {
      console.error('[BYTEBEAT] Formula compilation failed:', e.message);
      return null;
    }
  }

  // ============================================================
  // Audio Processing
  // ============================================================

  function processBytebeat(outputBuffer) {
    var output = outputBuffer.getChannelData(0);
    var hostRate = audioContext.sampleRate;
    var bbRate = settings.sampleRate;
    var ratio = bbRate / hostRate;
    var depth = settings.bitDepth;
    var inc = settings.tIncrement;

    if (!formulaFn || !playing) {
      // Fade out smoothly
      for (var s = 0; s < output.length; s++) {
        currentVolume += (0 - currentVolume) * volumeSmoothRate;
        output[s] = lastBytebeatSample * currentVolume;
      }
      return;
    }

    var vol = settings.volume / 100;
    var startTime = performance.now();

    for (var i = 0; i < output.length; i++) {
      // Guard against runaway formulas: check elapsed time every 256 samples
      if ((i & 255) === 0 && i > 0) {
        var elapsed = performance.now() - startTime;
        if (elapsed > MAX_PROCESS_TIME_MS) {
          // Fill remainder with last sample and bail
          for (var fill = i; fill < output.length; fill++) {
            output[fill] = lastBytebeatSample * currentVolume;
          }
          console.warn('[BYTEBEAT] Process time exceeded limit, truncated at sample ' + i);
          break;
        }
      }

      // Accumulate fractional samples for rate conversion
      sampleAccumulator += ratio;

      while (sampleAccumulator >= 1.0) {
        sampleAccumulator -= 1.0;

        // Evaluate the bytebeat formula (sandboxed, try/catch inside)
        var raw = formulaFn(tCounter);

        // Track errors: if formula returns NaN/undefined, count as error
        if (raw !== raw || raw === undefined) {
          raw = 0;
          _consecutiveErrors++;
          if (_consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error('[BYTEBEAT] Too many formula errors, stopping playback');
            playing = false;
            return;
          }
        } else {
          _consecutiveErrors = 0;
        }

        // Scale based on bit depth
        if (depth === 8) {
          raw = (raw & 255);
          lastBytebeatSample = (raw / 127.5) - 1.0;
        } else {
          raw = (raw & 65535);
          lastBytebeatSample = (raw / 32767.5) - 1.0;
        }

        tCounter += inc;
      }

      // Volume smoothing
      targetVolume = vol;
      currentVolume += (targetVolume - currentVolume) * volumeSmoothRate;

      output[i] = lastBytebeatSample * currentVolume;
    }
  }

  // ============================================================
  // Engine Init
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[BYTEBEAT] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    scriptNode = audioContext.createScriptProcessor(bufSize, 0, 1);
    scriptNode.onaudioprocess = function(event) {
      processBytebeat(event.outputBuffer);
    };

    // Compile default formula
    formulaFn = compileFormula(settings.formula);
    volumeSmoothRate = 1.0 / (0.01 * audioContext.sampleRate);

    engineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Connection
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (!audioContext) {
      return null;
    }
    if (!filterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      filterNodes[instId] = node;
    }
    return filterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = filterNodes[instId];
    if (!filterNode) {
      return;
    }
    var filterSettings = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
    if (!filterSettings || !filterSettings.enabled) {
      filterNode.type = 'lowpass';
      filterNode.frequency.value = 20000;
      filterNode.Q.value = 0.707;
    } else {
      filterNode.type = filterSettings.type || 'lowpass';
      filterNode.frequency.value = Math.max(20, Math.min(20000, filterSettings.frequency || 20000));
      filterNode.Q.value = Math.max(0.1, Math.min(30, filterSettings.resonance || 1));
    }
  }

  function connectToOutput(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    if (!scriptNode) {
      return;
    }

    if (connectedInsts[instId]) {
      updateFilter(instId);
    } else {
      var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
      var inst = instruments ? instruments[instId] : null;
      var destination;

      if (inst && inst.masterOutput) {
        destination = inst.masterOutput;
      } else if (audioContext) {
        destination = audioContext.destination;
      } else {
        return;
      }

      var filterNode = getOrCreateFilterNode(instId);
      updateFilter(instId);

      // DC blocking filter — bytebeat formulas often produce asymmetric waveforms
      var DC_BLOCK_FREQ = 10;
      var dcBlocker = audioContext.createBiquadFilter();
      dcBlocker.type = 'highpass';
      dcBlocker.frequency.value = DC_BLOCK_FREQ;
      dcBlocker.Q.value = 0.707;

      if (filterNode) {
        scriptNode.connect(filterNode);
        filterNode.connect(dcBlocker);
      } else {
        scriptNode.connect(dcBlocker);
      }
      dcBlocker.connect(destination);

      connectedInsts[instId] = true;
    }
  }

  // ============================================================
  // Playback Control
  // ============================================================

  function start() {
    if (!engineReady) {
      // Auto-initialize if AudioContext is available
      var ctx = (SL.audio && SL.audio.getCtx) ? SL.audio.getCtx() : null;
      if (ctx) {
        init(ctx);
      }
      if (!engineReady) {
        return;
      }
    }
    // Ensure the ScriptProcessor is connected to output
    var instId = (SL.audio && SL.audio.getCurrentInstrument) ? SL.audio.getCurrentInstrument() : 0;
    if (!connectedInsts[instId]) {
      connectToOutput(instId);
    }
    playing = true;
    targetVolume = settings.volume / 100;
  }

  function stop() {
    playing = false;
    targetVolume = 0;
    tCounter = 0;
    sampleAccumulator = 0;
  }

  function resetCounter() {
    tCounter = 0;
    sampleAccumulator = 0;
  }

  // ============================================================
  // Settings
  // ============================================================

  function setFormula(expr) {
    var fn = compileFormula(expr);
    if (fn) {
      settings.formula = expr;
      formulaFn = fn;
      tCounter = 0;
      sampleAccumulator = 0;
    }
  }

  function setFormulaByIndex(index) {
    if (index >= 0 && index < FORMULA_LIBRARY.length) {
      settings.formulaIndex = index;
      setFormula(FORMULA_LIBRARY[index].expr);
    }
  }

  function setRate(hz) {
    settings.sampleRate = Math.max(MIN_SAMPLE_RATE, Math.min(MAX_SAMPLE_RATE, hz));
  }

  function setSampleRate(sr) {
    setRate(sr);
  }

  function setTIncrement(inc) {
    settings.tIncrement = Math.max(1, Math.min(64, Math.round(inc)));
  }

  function setBitDepth(depth) {
    if (depth === 8 || depth === 16) {
      settings.bitDepth = depth;
    }
  }

  function setVolume(vol) {
    settings.volume = Math.max(0, Math.min(100, vol));
  }

  function getFormulas() {
    var result = [];
    for (var i = 0; i < FORMULA_LIBRARY.length; i++) {
      result.push({
        name: FORMULA_LIBRARY[i].name,
        expr: FORMULA_LIBRARY[i].expr,
        category: FORMULA_LIBRARY[i].category
      });
    }
    return result;
  }

  function getSettings() {
    return JSON.parse(JSON.stringify(settings));
  }

  function setSettings(newSettings) {
    if (newSettings) {
      if (newSettings.formula !== undefined) {
        setFormula(newSettings.formula);
      }
      if (newSettings.formulaIndex !== undefined) {
        settings.formulaIndex = newSettings.formulaIndex;
      }
      if (newSettings.sampleRate !== undefined) {
        setRate(newSettings.sampleRate);
      }
      if (newSettings.tIncrement !== undefined) {
        setTIncrement(newSettings.tIncrement);
      }
      if (newSettings.bitDepth !== undefined) {
        setBitDepth(newSettings.bitDepth);
      }
      if (newSettings.volume !== undefined) {
        setVolume(newSettings.volume);
      }
    }
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_BYTEBEAT_SETTINGS));
  }

  function isReady() {
    return engineReady;
  }

  function isPlaying() {
    return playing;
  }

  // ============================================================
  // Export
  // ============================================================

  SL.bytebeat = {
    init: init,
    isReady: isReady,
    isPlaying: isPlaying,
    start: start,
    stop: stop,
    resetCounter: resetCounter,
    setFormula: setFormula,
    setFormulaByIndex: setFormulaByIndex,
    setRate: setRate,
    setSampleRate: setSampleRate,
    setTIncrement: setTIncrement,
    setBitDepth: setBitDepth,
    setVolume: setVolume,
    getFormulas: getFormulas,
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,
    FORMULA_LIBRARY: FORMULA_LIBRARY,
    DEFAULT_BYTEBEAT_SETTINGS: DEFAULT_BYTEBEAT_SETTINGS
  };

})();
