import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from "@rollup/plugin-terser";

export default {
	input: 'src/index.ts',
	output: {
		file: 'dist/index.min.js',
		sourcemap: false,
		format: 'iife',
		name: 'bundle',
	},
	plugins: [
		
		resolve({
			browser: true,
		}),
		commonjs(),
		typescript({
			sourceMap: false,
			inlineSources: false,
		}),
		terser(),
	],
};