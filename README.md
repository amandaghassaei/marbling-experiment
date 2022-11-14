# Marbling Experiment

An early experiment toward building a marbling simulation

## Performance

This application will run any device/browser supporting WebGL2 *or* WebGL1.

The simulation doesn't start running until a pointerdown/pointermove event is detected on the canvas.  After 15 seconds without interaction, the simulation stops on its own until another pointerdown/pointermove event is detected.


## Use

To embed this simulation in a page with an iframe:
```html
<!-- iframe can be any width and height -->
<iframe style="width:100%;height:500px;border:none;background-color:#cccccc;" src="https://apps.amandaghassaei.com/marbling-experiment/"></iframe>
```

An example of embedding this page with an iframe is currently hosted at [apps.amandaghassaei.com/marbling-experiment/embed/](https://apps.amandaghassaei.com/marbling-experiment/embed/)

A sample page with a full-screen simulation is currently hosted at [apps.amandaghassaei.com/marbling-experiment/](https://apps.amandaghassaei.com/marbling-experiment/)

Compiled js code is in [dist/index.min.js](./dist/index.min.js)


## Development

To install all development dependencies, run:

```sh
npm install
```

To build `src` to `dist`, run:

```sh
npm run build
```

## License

This work is licensed under an [MIT License](./LICENSE).  Note that it depends on the following:

- [gpu-io](https://github.com/amandaghassaei/gpu-io) - MIT license, 4 dependencies:
  - [@amandaghassaei/type-checks](https://www.npmjs.com/package/@amandaghassaei/type-checks) - MIT license, no dependencies.
  - [@petamoriken/float16](https://www.npmjs.com/package/@petamoriken/float16) - MIT license, no dependencies.
  - [changedpi](https://www.npmjs.com/package/changedpi) - MIT license, no dependencies.
  - [file-saver](https://www.npmjs.com/package/file-saver) - MIT license, no dependencies.

## Testing

This application is built on top of [gpu-io](https://github.com/amandaghassaei/gpu-io), which has been [extensively tested in a variety of device/browser combinations](https://github.com/amandaghassaei/gpu-io/tree/main/tests).  All functionality is supported by both WebGL2 and older browsers that only support WebGL1.