# -*- mode: ruby -*-
# vi: set ft=ruby :
Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/bionic64"
  config.vm.provision "shell", inline: <<-SHELL
    bash <(wget -qO- https://deb.nodesource.com/setup_11.x)
    apt-get update
    apt-get install -y nodejs mariadb-server
    mkdir -pv /{tmp,vagrant}/node_modules
    chown -v vagrant /tmp/node_modules
    echo "/tmp/node_modules /vagrant/node_modules none defaults,bind 0 0" | tee -a /etc/fstab
    mount -v /vagrant/node_modules
  SHELL
end
