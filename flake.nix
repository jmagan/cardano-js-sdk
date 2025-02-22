{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

  outputs = {
    self,
    nixpkgs,
  }: {
    packages.x86_64-linux.default = let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      chromedriverBin = pkgs.fetchurl {
        url = "https://chromedriver.storage.googleapis.com/102.0.5005.61/chromedriver_linux64.zip";
        hash = "sha256-SwB82rvinNOBKT3z8odrHamtMKZZWdUY6nJKst7b9Ts=";
      };
    in
      (pkgs.callPackage ./yarn-project.nix {} {src = ./.;}).overrideAttrs (oldAttrs: {
        # A bunch of deps build binaries using node-gyp that requires Python
        PYTHON = "${pkgs.python3}/bin/python3";
        # chromedriver wants to download the binary
        CHROMEDRIVER_FILEPATH = "${chromedriverBin}";
        # node-hid uses pkg-config to find sources
        buildInputs = oldAttrs.buildInputs ++ [pkgs.pkg-config pkgs.libusb1];
        # run actual build
        buildPhase = ''
          yarn build
        '';
        # add a bin script that should be used to run cardano-services CLI
        postInstall = ''
          cat > $out/bin/cli <<EOF
          #!${pkgs.bash}/bin/bash
          exec "${pkgs.nodejs}/bin/node" "$out/libexec/$sourceRoot/packages/cardano-services/dist/cjs/cli.js" "\$@"
          EOF
          chmod a+x $out/bin/cli
        '';
        meta.mainProgram = "cli";
      });
  };
}
