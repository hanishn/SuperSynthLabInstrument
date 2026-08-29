class SpectralHoldProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freeze', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'smear', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'decay', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'bright', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'pitchOffset', defaultValue: 0, minValue: -12, maxValue: 12 }
    ];
  }

  process(inputs, outputs) {
    var input = inputs[0];
    var output = outputs[0];
    var leftIn = input && input[0] ? input[0] : null;
    var rightIn = input && input[1] ? input[1] : leftIn;
    var leftOut = output && output[0] ? output[0] : null;
    var rightOut = output && output[1] ? output[1] : null;
    if (leftOut) {
      for (var i = 0; i < leftOut.length; i++) {
        leftOut[i] = leftIn ? leftIn[i] : 0;
        if (rightOut) {
          rightOut[i] = rightIn ? rightIn[i] : leftOut[i];
        }
      }
    }
    return true;
  }
}

registerProcessor('spectral-hold-worklet', SpectralHoldProcessor);
