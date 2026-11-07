// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// The ERC-8004 team deploys its registries behind a two step UUPS bootstrap: a proxy first points at a placeholder
/// that sets the owner and the identity registry in slot 0, then the owner upgrades it to the real implementation.
/// Their placeholder, MinimalUUPS, hard codes their own deployer as owner. This is the same placeholder with the owner
/// passed in, so the official IdentityRegistryUpgradeable and ValidationRegistryUpgradeable can be deployed unmodified.
contract Bootstrap is OwnableUpgradeable, UUPSUpgradeable {
    /// @dev Identity registry address stored at slot 0 (matches the real implementations)
    address private _identityRegistry;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address identityRegistry_) public initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        _identityRegistry = identityRegistry_;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
