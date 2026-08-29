class GrainfieldProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'density', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'grainSize', defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'delay', defaultValue: 0.2, minValue: 0, maxValue: 1 },
      { name: 'spread', defaultValue: 0.7, minValue: 0, maxValue: 1 },
      { name: 'feedback', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'freeze', defaultValue: 0, minValue: 0, maxValue: 1 }
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

registerProcessor('grainfield-processor', GrainfieldProcessor);
