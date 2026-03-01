import path from 'path';
// const HtmlWebpackPlugin = require('html-webpack-plugin');

export default{
  mode: 'development', // or 'production'
  entry: './main.ts',
  output: {
    filename: 'bundle.js',
    path: path.resolve(process.cwd(), 'public')
  },
  // devtool: 'inline-source-map', // Generates source maps for debugging
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        include: [path.resolve(process.cwd())],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'], // Resolve these extensions
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  plugins: [
    // Generates an index.html file that includes the bundled script
    // new HtmlWebpackPlugin({
    //   template: path.resolve(__dirname, 'src', 'index.html'),
    // }),
  ],
  // devServer: {
  //   static: './dist', // Serve content from the dist directory
  //   open: true, // Open the browser after starting the server
  // },
};
