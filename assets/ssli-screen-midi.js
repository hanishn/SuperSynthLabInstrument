// SSLI Screen: MIDI — Device management, routing, and MIDI monitor
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_MONITOR_MESSAGES = 50;
  var TEST_NOTE_MIDI = 60;      // Middle C
  var TEST_NOTE_VELOCITY = 100;
  var TEST_NOTE_DURATION_MS = 500;
  var ACTIVITY_FLASH_MS = 120;
  var CHANNEL_ALL = -1;
  var CHANNEL_MIN = 1;
  var CHANNEL_MAX = 16;

  // MIDI status bytes
  var STATUS_NOTE_ON = 0x90;
  var STATUS_NOTE_OFF = 0x80;
  var STATUS_CC = 0xB0;
  var STATUS_PITCH_BEND = 0xE0;
  var STATUS_PROGRAM_CHANGE = 0xC0;
  var STATUS_AFTERTOUCH = 0xD0;
  var STATUS_POLY_AT = 0xA0;

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // ============================================================
  // State
  // ============================================================

  var _initialized = false;
  var _active = false;
  var _screenEl = null;

  // DOM caches
  var _inputSelect = null;
  var _outputSelect = null;
  var _inputChannelSelect = null;
  var _outputChannelSelect = null;
  var _inputStatusDot = null;
  var _outputStatusDot = null;
  var _inputActivityLed = null;
  var _outputActivityLed = null;
  var _monitorLog = null;
  var _monitorMessages = [];

  // Timers
  var _inputFlashTimer = null;
  var _outputFlashTimer = null;
  var _testNoteTimer = null;

  // Selected channel filter for input
  var _inputChannel = CHANNEL_ALL;
  var _outputChannel = 1;

  // Original MIDI handler reference
  var _origMidiHandler = null;

  // ============================================================
  // Helpers
  // ============================================================

  function _midiNoteToName(midi) {
    var pc = midi % 12;
    var oct = Math.floor(midi / 12) - 1;
    return NOTE_NAMES[pc] + oct;
  }

  function _formatMidiMessage(direction, channel, type, data1, data2) {
    var ch = 'Ch.' + (channel + 1);
    var msg = '[' + direction + '] ' + ch + ' ';

    if (type === 'NoteOn') {
      msg += 'NoteOn ' + _midiNoteToName(data1) + ' vel=' + data2;
    } else if (type === 'NoteOff') {
      msg += 'NoteOff ' + _midiNoteToName(data1);
    } else if (type === 'CC') {
      msg += 'CC#' + data1 + ' val=' + data2;
    } else if (type === 'PitchBend') {
      var bendVal = ((data2 << 7) | data1) - 8192;
      msg += 'PitchBend ' + bendVal;
    } else if (type === 'PC') {
      msg += 'PC ' + data1;
    } else if (type === 'AT') {
      msg += 'Aftertouch ' + data1;
    } else if (type === 'PolyAT') {
      msg += 'PolyAT ' + _midiNoteToName(data1) + ' ' + data2;
    } else {
      msg += type + ' ' + data1 + ' ' + data2;
    }

    return msg;
  }

  // ============================================================
  // MIDI Monitor
  // ============================================================

  function _addMonitorMessage(text) {
    _monitorMessages.push(text);
    if (_monitorMessages.length > MAX_MONITOR_MESSAGES) {
      _monitorMessages.shift();
    }
    _updateMonitorDisplay();
  }

  function _updateMonitorDisplay() {
    if (!_monitorLog) {
      return;
    }
    _monitorLog.textContent = _monitorMessages.join('\n');
    _monitorLog.scrollTop = _monitorLog.scrollHeight;
  }

  function _clearMonitor() {
    _monitorMessages = [];
    _updateMonitorDisplay();
  }

  // ============================================================
  // Activity LEDs
  // ============================================================

  function _flashInputLed() {
    if (_inputActivityLed) {
      _inputActivityLed.classList.add('flash');
      if (_inputFlashTimer) {
        clearTimeout(_inputFlashTimer);
      }
      _inputFlashTimer = setTimeout(function() {
        if (_inputActivityLed) {
          _inputActivityLed.classList.remove('flash');
        }
        _inputFlashTimer = null;
      }, ACTIVITY_FLASH_MS);
    }
  }

  function _flashOutputLed() {
    if (_outputActivityLed) {
      _outputActivityLed.classList.add('flash');
      if (_outputFlashTimer) {
        clearTimeout(_outputFlashTimer);
      }
      _outputFlashTimer = setTimeout(function() {
        if (_outputActivityLed) {
          _outputActivityLed.classList.remove('flash');
        }
        _outputFlashTimer = null;
      }, ACTIVITY_FLASH_MS);
    }
  }

  // ============================================================
  // MIDI Input Handler (wraps SL.midi)
  // ============================================================

  function _interceptMidiInput(event) {
    var data = event.data;
    if (!data || data.length < 2) {
      return;
    }

    var status = data[0] & 0xF0;
    var channel = data[0] & 0x0F;
    var byte1 = data[1];
    var byte2 = data.length > 2 ? data[2] : 0;

    // Channel filter
    if (_inputChannel !== CHANNEL_ALL && (channel + 1) !== _inputChannel) {
      return;
    }

    // Flash activity LED
    _flashInputLed();

    // Determine message type for monitor
    var type = 'Unknown';
    if (status === STATUS_NOTE_ON && byte2 > 0) {
      type = 'NoteOn';
      // Route to keyboard
      if (SL.screenPlay && SL.screenPlay.noteOn) {
        SL.screenPlay.noteOn(byte1, byte2);
      }
    } else if (status === STATUS_NOTE_OFF || (status === STATUS_NOTE_ON && byte2 === 0)) {
      type = 'NoteOff';
      if (SL.screenPlay && SL.screenPlay.noteOff) {
        SL.screenPlay.noteOff(byte1);
      }
    } else if (status === STATUS_CC) {
      type = 'CC';
    } else if (status === STATUS_PITCH_BEND) {
      type = 'PitchBend';
    } else if (status === STATUS_PROGRAM_CHANGE) {
      type = 'PC';
    } else if (status === STATUS_AFTERTOUCH) {
      type = 'AT';
    } else if (status === STATUS_POLY_AT) {
      type = 'PolyAT';
    }

    // Add to monitor
    _addMonitorMessage(_formatMidiMessage('IN', channel, type, byte1, byte2));
  }

  // ============================================================
  // Device Scanning
  // ============================================================

  function _scanDevices() {
    if (!navigator.requestMIDIAccess) {
      _addMonitorMessage('[SYS] Web MIDI API not available');
      _updateConnectionStatus();
      return;
    }

    navigator.requestMIDIAccess({ sysex: false }).then(
      function(access) {
        _populateDeviceSelects(access);
        _addMonitorMessage('[SYS] MIDI devices scanned');
        _updateConnectionStatus();
      },
      function(err) {
        _addMonitorMessage('[SYS] MIDI access denied: ' + err.message);
        _updateConnectionStatus();
      }
    );
  }

  function _populateDeviceSelects(access) {
    // Input devices
    if (_inputSelect) {
      _inputSelect.innerHTML = '';
      var noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = SL.t('midi.none');
      _inputSelect.appendChild(noneOpt);

      access.inputs.forEach(function(input) {
        var opt = document.createElement('option');
        opt.value = input.id;
        opt.textContent = input.name + (input.manufacturer ? ' (' + input.manufacturer + ')' : '');
        _inputSelect.appendChild(opt);
      });

      // Auto-select if only one device
      if (access.inputs.size === 1) {
        access.inputs.forEach(function(input) {
          _inputSelect.value = input.id;
          _onInputDeviceChange();
        });
      }
    }

    // Output devices
    if (_outputSelect) {
      _outputSelect.innerHTML = '';
      var noneOptOut = document.createElement('option');
      noneOptOut.value = '';
      noneOptOut.textContent = SL.t('midi.none');
      _outputSelect.appendChild(noneOptOut);

      access.outputs.forEach(function(output) {
        var opt = document.createElement('option');
        opt.value = output.id;
        opt.textContent = output.name + (output.manufacturer ? ' (' + output.manufacturer + ')' : '');
        _outputSelect.appendChild(opt);
      });
    }
  }

  function _onInputDeviceChange() {
    if (!_inputSelect) {
      return;
    }
    var deviceId = _inputSelect.value;
    if (SL.midi && SL.midi.selectInput) {
      SL.midi.selectInput(deviceId);
    }
    _updateConnectionStatus();
  }

  function _onOutputDeviceChange() {
    if (!_outputSelect) {
      return;
    }
    var deviceId = _outputSelect.value;
    if (SL.midi && SL.midi.selectOutput) {
      SL.midi.selectOutput(deviceId);
    }
    _updateConnectionStatus();
  }

  function _updateConnectionStatus() {
    if (_inputStatusDot) {
      var hasInput = _inputSelect && _inputSelect.value !== '';
      if (hasInput) {
        _inputStatusDot.classList.add('connected');
        _inputStatusDot.classList.remove('disconnected');
      } else {
        _inputStatusDot.classList.remove('connected');
        _inputStatusDot.classList.add('disconnected');
      }
    }
    if (_outputStatusDot) {
      var hasOutput = _outputSelect && _outputSelect.value !== '';
      if (hasOutput) {
        _outputStatusDot.classList.add('connected');
        _outputStatusDot.classList.remove('disconnected');
      } else {
        _outputStatusDot.classList.remove('connected');
        _outputStatusDot.classList.add('disconnected');
      }
    }
  }

  // ============================================================
  // Send Test Note
  // ============================================================

  function _sendTestNote() {
    if (_testNoteTimer) {
      clearTimeout(_testNoteTimer);
      _testNoteTimer = null;
    }

    if (SL.midi && SL.midi.sendNoteOn) {
      var channel = _outputChannel - 1;
      SL.midi.sendNoteOn(TEST_NOTE_MIDI, TEST_NOTE_VELOCITY, channel);
      _flashOutputLed();
      _addMonitorMessage(_formatMidiMessage('OUT', channel, 'NoteOn', TEST_NOTE_MIDI, TEST_NOTE_VELOCITY));

      _testNoteTimer = setTimeout(function() {
        if (SL.midi && SL.midi.sendNoteOff) {
          SL.midi.sendNoteOff(TEST_NOTE_MIDI, channel);
          _flashOutputLed();
          _addMonitorMessage(_formatMidiMessage('OUT', channel, 'NoteOff', TEST_NOTE_MIDI, 0));
        }
        _testNoteTimer = null;
      }, TEST_NOTE_DURATION_MS);
    } else {
      _addMonitorMessage('[SYS] MIDI output not available');
    }
  }

  // ============================================================
  // Build Screen
  // ============================================================

  function _buildScreen() {
    _screenEl = document.getElementById('ssli-screen-midi');
    if (!_screenEl) {
      return;
    }
    _screenEl.innerHTML = '';

    var container = document.createElement('div');
    container.className = 'ssli-midi-container';

    // F3-05: Show browser compatibility notice if Web MIDI API is unavailable
    var midiApiAvailable = !!(navigator.requestMIDIAccess);
    if (!midiApiAvailable) {
      var unavailNotice = document.createElement('div');
      unavailNotice.className = 'ssli-midi-unavailable';
      unavailNotice.textContent = SL.t('midi.unsupported_notice');
      container.appendChild(unavailNotice);
    }

    // --- Two-column row for Input + Output ---
    var ioRow = document.createElement('div');
    ioRow.className = 'ssli-midi-io-row';

    // --- MIDI Input Section ---
    var inputSection = document.createElement('div');
    inputSection.className = 'ssli-shape-section ssli-midi-io-section';

    var inputTitle = document.createElement('div');
    inputTitle.className = 'ssli-shape-section-title';
    inputTitle.textContent = SL.t('midi.input_title');
    inputSection.appendChild(inputTitle);

    // Scan button + status inline
    var scanRow = document.createElement('div');
    scanRow.className = 'ssli-shape-row';
    var scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'ssli-midi-scan-btn';
    scanBtn.textContent = SL.t('midi.scan_devices');
    scanBtn.addEventListener('click', _scanDevices);
    scanRow.appendChild(scanBtn);

    _inputStatusDot = document.createElement('span');
    _inputStatusDot.className = 'ssli-midi-status-dot disconnected';
    _inputStatusDot.title = 'Connection status';
    scanRow.appendChild(_inputStatusDot);

    _inputActivityLed = document.createElement('span');
    _inputActivityLed.className = 'ssli-midi-activity-led';
    _inputActivityLed.title = 'Activity';
    scanRow.appendChild(_inputActivityLed);

    inputSection.appendChild(scanRow);

    // Device dropdown
    var inputDevRow = document.createElement('div');
    inputDevRow.className = 'ssli-shape-row';
    var inputDevLabel = document.createElement('span');
    inputDevLabel.className = 'ssli-shape-label';
    inputDevLabel.textContent = SL.t('midi.device');
    _inputSelect = document.createElement('select');
    _inputSelect.className = 'ssli-sound-select';
    _inputSelect.setAttribute('aria-label', 'MIDI Input Device');
    var noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = SL.t('midi.none');
    _inputSelect.appendChild(noneOpt);
    _inputSelect.addEventListener('change', _onInputDeviceChange);
    inputDevRow.appendChild(inputDevLabel);
    inputDevRow.appendChild(_inputSelect);
    inputSection.appendChild(inputDevRow);

    // Channel selector
    var inputChRow = document.createElement('div');
    inputChRow.className = 'ssli-shape-row';
    var inputChLabel = document.createElement('span');
    inputChLabel.className = 'ssli-shape-label';
    inputChLabel.textContent = SL.t('midi.channel');
    _inputChannelSelect = document.createElement('select');
    _inputChannelSelect.className = 'ssli-sound-select ssli-midi-channel-select';
    _inputChannelSelect.setAttribute('aria-label', 'MIDI Input Channel');
    var allOpt = document.createElement('option');
    allOpt.value = String(CHANNEL_ALL);
    allOpt.textContent = SL.t('midi.all_channels');
    _inputChannelSelect.appendChild(allOpt);
    for (var ch = CHANNEL_MIN; ch <= CHANNEL_MAX; ch++) {
      var chOpt = document.createElement('option');
      chOpt.value = String(ch);
      chOpt.textContent = String(ch);
      _inputChannelSelect.appendChild(chOpt);
    }
    _inputChannelSelect.addEventListener('change', function() {
      _inputChannel = parseInt(_inputChannelSelect.value, 10);
      if (SL.midi && SL.midi.setMidiConfig && _inputChannel !== CHANNEL_ALL) {
        SL.midi.setMidiConfig(0, { channel: _inputChannel - 1 });
      }
    });
    inputChRow.appendChild(inputChLabel);
    inputChRow.appendChild(_inputChannelSelect);
    inputSection.appendChild(inputChRow);

    ioRow.appendChild(inputSection);

    // --- MIDI Output Section ---
    var outputSection = document.createElement('div');
    outputSection.className = 'ssli-shape-section ssli-midi-io-section';

    var outputTitle = document.createElement('div');
    outputTitle.className = 'ssli-shape-section-title';
    outputTitle.textContent = SL.t('midi.output_title');
    outputSection.appendChild(outputTitle);

    // Device + status
    var outputDevRow = document.createElement('div');
    outputDevRow.className = 'ssli-shape-row';
    var outputDevLabel = document.createElement('span');
    outputDevLabel.className = 'ssli-shape-label';
    outputDevLabel.textContent = SL.t('midi.device');
    _outputSelect = document.createElement('select');
    _outputSelect.className = 'ssli-sound-select';
    _outputSelect.setAttribute('aria-label', 'MIDI Output Device');
    var noneOptOut = document.createElement('option');
    noneOptOut.value = '';
    noneOptOut.textContent = SL.t('midi.none');
    _outputSelect.appendChild(noneOptOut);
    _outputSelect.addEventListener('change', _onOutputDeviceChange);

    _outputStatusDot = document.createElement('span');
    _outputStatusDot.className = 'ssli-midi-status-dot disconnected';
    _outputStatusDot.title = 'Connection status';

    _outputActivityLed = document.createElement('span');
    _outputActivityLed.className = 'ssli-midi-activity-led';
    _outputActivityLed.title = 'Activity';

    outputDevRow.appendChild(outputDevLabel);
    outputDevRow.appendChild(_outputSelect);
    outputDevRow.appendChild(_outputStatusDot);
    outputDevRow.appendChild(_outputActivityLed);
    outputSection.appendChild(outputDevRow);

    // Output channel + test button inline
    var outputChRow = document.createElement('div');
    outputChRow.className = 'ssli-shape-row';
    var outputChLabel = document.createElement('span');
    outputChLabel.className = 'ssli-shape-label';
    outputChLabel.textContent = SL.t('midi.channel');
    _outputChannelSelect = document.createElement('select');
    _outputChannelSelect.className = 'ssli-sound-select ssli-midi-channel-select';
    _outputChannelSelect.setAttribute('aria-label', 'MIDI Output Channel');
    for (var outCh = CHANNEL_MIN; outCh <= CHANNEL_MAX; outCh++) {
      var outChOpt = document.createElement('option');
      outChOpt.value = String(outCh);
      outChOpt.textContent = String(outCh);
      _outputChannelSelect.appendChild(outChOpt);
    }
    _outputChannelSelect.addEventListener('change', function() {
      _outputChannel = parseInt(_outputChannelSelect.value, 10);
    });
    var testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'ssli-midi-test-btn';
    testBtn.textContent = SL.t('midi.send_test_note');
    testBtn.addEventListener('click', _sendTestNote);
    outputChRow.appendChild(outputChLabel);
    outputChRow.appendChild(_outputChannelSelect);
    outputChRow.appendChild(testBtn);
    outputSection.appendChild(outputChRow);

    ioRow.appendChild(outputSection);

    container.appendChild(ioRow);

    // --- MIDI Monitor Section ---
    var monitorSection = document.createElement('div');
    monitorSection.className = 'ssli-shape-section ssli-midi-monitor-section';

    var monitorHeader = document.createElement('div');
    monitorHeader.className = 'ssli-midi-monitor-header';

    var monitorTitle = document.createElement('div');
    monitorTitle.className = 'ssli-shape-section-title';
    monitorTitle.textContent = SL.t('midi.monitor_title');
    monitorHeader.appendChild(monitorTitle);

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ssli-midi-clear-btn';
    clearBtn.textContent = SL.t('midi.clear');
    clearBtn.addEventListener('click', _clearMonitor);
    monitorHeader.appendChild(clearBtn);

    monitorSection.appendChild(monitorHeader);

    _monitorLog = document.createElement('pre');
    _monitorLog.className = 'ssli-midi-monitor-log';
    _monitorLog.setAttribute('aria-label', 'MIDI message log');
    _monitorLog.setAttribute('aria-live', 'polite');
    monitorSection.appendChild(_monitorLog);

    container.appendChild(monitorSection);

    _screenEl.appendChild(container);

    // Initial connection status
    _updateConnectionStatus();

    // Populate from existing SL.midi devices if already scanned
    if (SL.midi && SL.midi.isEnabled && SL.midi.isEnabled()) {
      var inputs = SL.midi.getInputDevices();
      for (var ii = 0; ii < inputs.length; ii++) {
        var inOpt = document.createElement('option');
        inOpt.value = inputs[ii].id;
        inOpt.textContent = inputs[ii].name + (inputs[ii].manufacturer ? ' (' + inputs[ii].manufacturer + ')' : '');
        _inputSelect.appendChild(inOpt);
      }
      var outputs = SL.midi.getOutputDevices();
      for (var oi = 0; oi < outputs.length; oi++) {
        var outOpt = document.createElement('option');
        outOpt.value = outputs[oi].id;
        outOpt.textContent = outputs[oi].name + (outputs[oi].manufacturer ? ' (' + outputs[oi].manufacturer + ')' : '');
        _outputSelect.appendChild(outOpt);
      }
      _updateConnectionStatus();
    }
  }

  // ============================================================
  // Activate / Deactivate
  // ============================================================

  function activate() {
    _active = true;
    if (!_initialized) {
      _buildScreen();
      _initialized = true;

      // Re-translate all visible text when the UI language changes
      if (SL.localization && SL.localization.onLanguageChange) {
        SL.localization.onLanguageChange(function() {
          if (_active) {
            _buildScreen();
            _updateMonitorDisplay();
          }
        });
      }
    }
  }

  function deactivate() {
    _active = false;
    // E-01: Stop test note if playing
    if (_testNoteTimer) {
      clearTimeout(_testNoteTimer);
      if (SL.midi && SL.midi.sendNoteOff) {
        SL.midi.sendNoteOff(TEST_NOTE_MIDI, _outputChannel - 1);
      }
      _testNoteTimer = null;
    }
    // E-01: Clear activity LED flash timers
    if (_inputFlashTimer) {
      clearTimeout(_inputFlashTimer);
      _inputFlashTimer = null;
    }
    if (_outputFlashTimer) {
      clearTimeout(_outputFlashTimer);
      _outputFlashTimer = null;
    }
  }

  // ============================================================
  // Register
  // ============================================================

  SL.screenMidi = {
    activate: activate,
    deactivate: deactivate,
    addMonitorMessage: _addMonitorMessage,
    flashInputLed: _flashInputLed,
    flashOutputLed: _flashOutputLed
  };

})();
