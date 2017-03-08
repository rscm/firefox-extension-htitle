#!/bin/bash

XPI=firefox-htitle.xpi

rm -f $XPI
cd xpi
zip -9r ../$XPI *

